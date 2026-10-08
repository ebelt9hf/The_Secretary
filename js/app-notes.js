/** Extract plain text from an HTML string using token-safe string stripping. */
function htmlToPlainText(html) {
  if (!html) return '';
  // Only strips when followed by valid HTML markup identifiers (e.g., <div>, </p>, <br/>)
  const text = html.replace(/<\/?[a-zA-Z!/][^>]*>/g, " ");
  return text.replace(/\s+/g, ' ').trim();
}

function mergeTodoEntries(base, override) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function normalizeTodoEntry(entry) {
  if (!entry || !entry.id) return null;
  const todo = { ...entry };
  if (todo.title && typeof todo.title === 'string') {
    todo.title = (typeof cleanTaskTitleText === 'function')
      ? cleanTaskTitleText(todo.title)
      : todo.title.replace(/^todo urgency:\s*(?:High|Medium|Low|Q1|Q2|Q3|Q4|\s*)*/i, '').trim();
  }
  if (todo.priority === 'WIP') {
    const basePriority = todo.originalPriority && todo.originalPriority !== 'WIP' ? todo.originalPriority : 'Medium';
    todo.status = 'WIP';
    todo.priority = basePriority;
    if (!todo.originalPriority || todo.originalPriority === 'WIP') todo.originalPriority = basePriority;
  }
  if (todo.status !== 'WIP') delete todo.status;
  if (todo.priority === 'Done' && todo.originalPriority === 'WIP') {
    todo.originalPriority = 'Medium';
  }
  // Ensure Eisenhower quadrant
  if (!['Q1', 'Q2', 'Q3', 'Q4'].includes(todo.eisenhowerQuadrant)) {
    todo.eisenhowerQuadrant = (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getQuadrant)
      ? EisenhowerUtils.getQuadrant(todo)
      : (todo.priority === 'High' ? 'Q1' : todo.priority === 'Low' ? 'Q3' : 'Q2');
  }
  todo.isHighPriority = Boolean(todo.isHighPriority);
  if (!todo.assignmentStatus) {
    const hasOwner = (todo.ownerId || todo.owner) && (todo.ownerId || todo.owner) !== 'me';
    todo.assignmentStatus = hasOwner ? 'pending_communication' : 'unassigned';
  }
  // Assign workstream from note if todo is linked to a note with a workstream and has no workstream assigned
  if (!todo.workstream && todo.noteId) {
    const linkedNote = (typeof getNoteById === 'function')
      ? getNoteById(todo.noteId)
      : ((typeof manifest !== 'undefined' && Array.isArray(manifest))
          ? manifest.find(n => n && (n.id === todo.noteId || n.path === todo.noteId))
          : ((typeof window !== 'undefined' && Array.isArray(window.manifest))
              ? window.manifest.find(n => n && (n.id === todo.noteId || n.path === todo.noteId))
              : ((typeof globalThis !== 'undefined' && Array.isArray(globalThis.manifest))
                  ? globalThis.manifest.find(n => n && (n.id === todo.noteId || n.path === todo.noteId))
                  : ((typeof currentNote !== 'undefined' && currentNote && (currentNote.id === todo.noteId || currentNote.path === todo.noteId)) ? currentNote : ((typeof window !== 'undefined' && window.currentNote && (window.currentNote.id === todo.noteId || window.currentNote.path === todo.noteId)) ? window.currentNote : ((typeof globalThis !== 'undefined' && globalThis.currentNote && (globalThis.currentNote.id === todo.noteId || globalThis.currentNote.path === todo.noteId)) ? globalThis.currentNote : null))))));
    if (linkedNote) {
      const noteWs = (typeof getNoteWorkstreamName === 'function' ? getNoteWorkstreamName(linkedNote) : '')
        || (typeof window !== 'undefined' && typeof window.getNoteWorkstreamName === 'function' ? window.getNoteWorkstreamName(linkedNote) : '')
        || (typeof globalThis !== 'undefined' && typeof globalThis.getNoteWorkstreamName === 'function' ? globalThis.getNoteWorkstreamName(linkedNote) : '')
        || (linkedNote.workstream || (Array.isArray(linkedNote.workstreams) ? linkedNote.workstreams[0] : '') || '');
      if (noteWs) {
        todo.workstream = noteWs;
      }
    }
  }
  if (todo.workstream) {
    if (!Array.isArray(todo.major_topic_tags)) {
      todo.major_topic_tags = [todo.workstream];
    } else if (!todo.major_topic_tags.includes(todo.workstream)) {
      todo.major_topic_tags.push(todo.workstream);
    }
  }
  // Normalize task dependencies (array of prerequisite todo IDs)
  if (!Array.isArray(todo.depends_on)) {
    todo.depends_on = [];
  } else {
    todo.depends_on = Array.from(new Set(todo.depends_on.map(String).filter(Boolean)));
  }
  return todo;
}

// ═══ Task Dependency & DAG Graph Engine ═══
const TaskGraphEngine = {
  getPrerequisites(todoId) {
    if (!todoId || typeof todosManifest === 'undefined' || !Array.isArray(todosManifest)) return [];
    const todo = (typeof getTodoById === 'function') ? getTodoById(todoId) : todosManifest.find(t => t.id === todoId);
    if (!todo || !Array.isArray(todo.depends_on)) return [];
    return todo.depends_on
      .map(id => (typeof getTodoById === 'function') ? getTodoById(id) : todosManifest.find(t => t.id === id))
      .filter(Boolean);
  },

  getDependents(todoId) {
    if (!todoId || typeof todosManifest === 'undefined' || !Array.isArray(todosManifest)) return [];
    const strId = String(todoId);
    return todosManifest.filter(t => t && Array.isArray(t.depends_on) && t.depends_on.map(String).includes(strId));
  },

  isBlocked(todoId) {
    const prereqs = this.getPrerequisites(todoId);
    if (!prereqs.length) return false;
    return prereqs.some(t => t.priority !== 'Done');
  },

  getUnresolvedBlockers(todoId) {
    const prereqs = this.getPrerequisites(todoId);
    return prereqs.filter(t => t && t.priority !== 'Done');
  },

  validateNoCircularDependency(sourceId, candidatePrereqId, returnDetails = false) {
    if (!sourceId || !candidatePrereqId) return returnDetails ? { valid: true, cyclePath: [] } : true;
    const src = String(sourceId);
    const cand = String(candidatePrereqId);
    if (src === cand) {
      return returnDetails ? { valid: false, cyclePath: [src, cand] } : false;
    }

    const visited = new Set();
    const parentMap = new Map();
    const stack = [cand];

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (currentId === src) {
        const cycle = [src];
        let curr = currentId;
        while (parentMap.has(curr) && curr !== cand) {
          curr = parentMap.get(curr);
          cycle.unshift(curr);
        }
        cycle.unshift(cand);
        return returnDetails ? { valid: false, cyclePath: cycle } : false;
      }
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const todo = (typeof getTodoById === 'function') ? getTodoById(currentId) : (todosManifest || []).find(t => t.id === currentId);
      if (todo && Array.isArray(todo.depends_on)) {
        for (const depId of todo.depends_on) {
          const depStr = String(depId);
          parentMap.set(depStr, currentId);
          stack.push(depStr);
        }
      }
    }
    return returnDetails ? { valid: true, cyclePath: [] } : true;
  },

  calculateCriticalPath() {
    if (typeof todosManifest === 'undefined' || !Array.isArray(todosManifest)) return [];
    const active = todosManifest.filter(t => t && t.priority !== 'Done' && (typeof isUserTask === 'function' ? isUserTask(t) : true));
    const activeMap = new Map(active.map(t => [String(t.id), t]));
    
    const memo = new Map();
    const pathMemo = new Map();

    function getLongestPath(id) {
      if (memo.has(id)) return memo.get(id);
      const todo = activeMap.get(id);
      if (!todo) return 0;

      const deps = TaskGraphEngine.getDependents(id).filter(d => activeMap.has(String(d.id)));
      if (deps.length === 0) {
        memo.set(id, 1);
        pathMemo.set(id, [id]);
        return 1;
      }

      let maxLen = 0;
      let bestNextPath = [];
      for (const next of deps) {
        const nextId = String(next.id);
        const len = getLongestPath(nextId);
        if (len > maxLen) {
          maxLen = len;
          bestNextPath = pathMemo.get(nextId) || [];
        }
      }

      const total = 1 + maxLen;
      memo.set(id, total);
      pathMemo.set(id, [id, ...bestNextPath]);
      return total;
    }

    let overallMax = 0;
    let criticalPathIds = [];

    for (const t of active) {
      const len = getLongestPath(String(t.id));
      if (len > overallMax) {
        overallMax = len;
        criticalPathIds = pathMemo.get(String(t.id)) || [];
      }
    }

    return criticalPathIds;
  },

  checkPriorityInversions() {
    if (typeof todosManifest === 'undefined' || !Array.isArray(todosManifest)) return [];
    const inversions = [];
    const quadRank = { Q1: 4, Q2: 3, Q3: 2, Q4: 1 };

    for (const todo of todosManifest) {
      if (!todo || todo.priority === 'Done' || (typeof isUserTask === 'function' && !isUserTask(todo))) continue;
      const todoQuad = (typeof getTodoQuadrant === 'function') ? getTodoQuadrant(todo) : (todo.eisenhowerQuadrant || 'Q2');
      const todoRank = quadRank[todoQuad] || 2;

      const blockers = this.getUnresolvedBlockers(todo.id);
      for (const blocker of blockers) {
        const blockerQuad = (typeof getTodoQuadrant === 'function') ? getTodoQuadrant(blocker) : (blocker.eisenhowerQuadrant || 'Q2');
        const blockerRank = quadRank[blockerQuad] || 2;

        if (todoRank >= 3 && blockerRank < 3) {
          inversions.push({
            task: todo,
            blocker: blocker,
            todoQuad,
            blockerQuad
          });
        }
      }
    }
    return inversions;
  }
};

if (typeof window !== 'undefined') {
  window.TaskGraphEngine = TaskGraphEngine;
}


window.changeTodoQuadrant = async function(todoId, newQuadrant) {
  const todo = getTodoById(todoId);
  if (!todo) return;
  todo.eisenhowerQuadrant = newQuadrant;
  todo.priority = (typeof EisenhowerUtils !== 'undefined') ? EisenhowerUtils.getPriorityForQuadrant(newQuadrant) : (newQuadrant === 'Q1' ? 'High' : 'Medium');
  
  if (typeof EisenhowerUtils !== 'undefined' && EisenhowerUtils.getDefaultCoordsForQuadrant) {
    const def = EisenhowerUtils.getDefaultCoordsForQuadrant(newQuadrant, todo.id);
    todo.eisenhowerX = def.x;
    todo.eisenhowerY = def.y;
  }

  todo.modified = new Date().toISOString().slice(0, 10);
  if (typeof saveTodosManifest === 'function') await saveTodosManifest();
  if (typeof renderTodosBoard === 'function') renderTodosBoard();
};

window.toggleTodoHighPriority = async function(todoId) {
  const todo = getTodoById(todoId);
  if (!todo) return;
  todo.isHighPriority = !todo.isHighPriority;
  todo.modified = new Date().toISOString().slice(0, 10);
  if (typeof saveTodosManifest === 'function') await saveTodosManifest();
  if (typeof renderTodosBoard === 'function') renderTodosBoard();
};

window.confirmTodoAssignment = async function(todoId) {
  const todo = getTodoById(todoId);
  if (!todo) return;
  todo.assignmentStatus = 'confirmed';
  todo.assignmentConfirmed = true;
  todo.modified = new Date().toISOString().slice(0, 10);
  if (typeof saveTodosManifest === 'function') await saveTodosManifest();
  if (typeof renderTodosBoard === 'function') renderTodosBoard();
  if (typeof toast === 'function') toast(t('todo.finallyAssigned') || 'Assignment confirmed!');
};

function normalizeTodoManifestEntries(entries) {
  if (!entries || !entries.length) return [];
  const uniqMap = new Map();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const todo = normalizeTodoEntry(entry);
    if (!todo) continue;

    const existing = uniqMap.get(todo.id);
    if (!existing) {
      uniqMap.set(todo.id, todo);
    } else {
      uniqMap.set(todo.id, normalizeTodoEntry(mergeTodoEntries(existing, todo)));
    }
  }
  return Array.from(uniqMap.values());
}

let _todosFullLoadPromise = null;

async function _readTodosManifestFromDisk() {
  const isFirebase = typeof StorageAPI !== 'undefined' && typeof StorageAPI.getStorageEngine === 'function' && StorageAPI.getStorageEngine() === 'firebase';
  const exists = await StorageAPI.hasTodosManifest();
  if (!exists) {
    if (!isFirebase) {
      await migrateToManifest();
    }
    return normalizeTodoManifestEntries(todosManifest || []);
  }
  try {
    const data = await StorageAPI.readTodosManifest();
    return normalizeTodoManifestEntries(Array.isArray(data) ? data : (todosManifest || []));
  } catch (e) {
    return normalizeTodoManifestEntries(todosManifest || []);
  }
}

async function ensureTodosManifestFullyLoaded() {
  if (todosLoadState === 'ready') return;
  if (_todosFullLoadPromise) return _todosFullLoadPromise;

  _todosFullLoadPromise = (async () => {
    try {
      const allTodos = await _readTodosManifestFromDisk();
      todosManifest = allTodos;
      todosLoadState = 'ready';

      if (typeof rebuildCollaborativeAggregates === 'function') rebuildCollaborativeAggregates();
      if (typeof renderBoard === 'function') renderBoard();
      if (activeTab === 'team' && typeof renderTeamPanel === 'function') renderTeamPanel();
      if (activeTab === 'planner' && typeof renderPlanner === 'function') renderPlanner();
      if (activeTab === 'retro' && typeof renderRetroPanel === 'function') renderRetroPanel();
    } catch (e) {
      todosLoadState = 'error';
      console.warn('Full todo hydration failed', e);
    }
  })();

  try {
    await _todosFullLoadPromise;
  } finally {
    _todosFullLoadPromise = null;
  }
}

async function saveTodosManifest(options = {}) {
  try {
    const deletedTodoIds = new Set((options.deletedIds || []).map(id => String(id)));
    // Advisory: signal intent to write so other windows can yield
    broadcastSync({ type: 'WILL_WRITE', file: 'todos/manifest.json' });
    // Re-read-before-write: merge our in-memory state onto the latest on-disk state
    // to prevent overwriting concurrent changes from another window
    let diskArr = [];
    try {
      diskArr = normalizeTodoManifestEntries(await StorageAPI.readTodosManifest());
    } catch (e) { /* file may not exist yet — use in-memory array as-is */ }

    const diskById = new Map(diskArr.map(todo => [todo.id, todo]));
    const merged = [];
    const ourIds = new Set();
    for (const todo of todosManifest) {
      if (deletedTodoIds.has(String(todo.id))) continue;
      const diskTodo = diskById.get(todo.id);
      merged.push(mergeTodoEntries(diskTodo, todo));
      ourIds.add(todo.id);
    }
    for (const diskTodo of diskArr) {
      if (!ourIds.has(diskTodo.id) && !deletedTodoIds.has(String(diskTodo.id))) merged.push({ ...diskTodo });
    }
    todosManifest = normalizeTodoManifestEntries(merged).filter(todo => !deletedTodoIds.has(String(todo.id)));
    todosLoadState = 'ready';
    await StorageAPI.writeTodosManifest(todosManifest);
    broadcastSync({ type: 'WRITE_DONE', file: 'todos/manifest.json' });
    broadcastSync({ type: 'TODOS_UPDATED' });

    if (typeof rebuildCollaborativeAggregates === 'function') {
      rebuildCollaborativeAggregates();
    }
    if (typeof renderTeamPanel === 'function' && activeTab === 'team') {
      renderTeamPanel();
    }
  } catch (e) {
    if (e && !e.message?.includes('No root folder handle loaded')) {
      console.warn('Could not save todos manifest', e);
    }
  }
}

function manifestEntryScore(entry) {
  if (!entry) return 0;
  let score = 0;
  if ((entry.group_tags || []).length) score += 8;
  if ((entry.major_topic_tags || []).length) score += 8;
  if ((entry.topic_tags || []).length) score += 4;
  if ((entry.extra_tags || []).length) score += 2;
  if (entry.date) score += 1;
  if (entry.modified) score += 1;
  return score;
}

function mergeManifestEntries(a, b) {
  const preferred = manifestEntryScore(b) >= manifestEntryScore(a) ? b : a;
  const preferredDecisions = Array.isArray(b.decisions)
    ? b.decisions
    : (Array.isArray(a.decisions) ? a.decisions : []);
  const preferredDecisionReady = b.decisionsReady === true || a.decisionsReady === true;
  return {
    id: preferred.id || a.id || b.id || '',
    title: preferred.title || a.title || b.title || '',
    path: preferred.path || a.path || b.path || '',
    group_tags: [...new Set([...(a.group_tags || []), ...(b.group_tags || [])])],
    major_topic_tags: [...new Set([...(a.major_topic_tags || []), ...(b.major_topic_tags || [])])],
    topic_tags: [...new Set([...(a.topic_tags || []), ...(b.topic_tags || [])])],
    extra_tags: [...new Set([...(a.extra_tags || []), ...(b.extra_tags || [])])],
    date: preferred.date || a.date || b.date || '',
    modified: preferred.modified || a.modified || b.modified || '',
    preview: preferred.preview || a.preview || b.preview || '',
    summary: preferred.summary || a.summary || b.summary || '',
    decisionsReady: preferredDecisionReady,
    decisions: normalizeMetadataDecisions(preferredDecisions),
    stats: {
      todoMarkers: Number(preferred.stats?.todoMarkers || a.stats?.todoMarkers || b.stats?.todoMarkers || 0),
      mentions: Number(preferred.stats?.mentions || a.stats?.mentions || b.stats?.mentions || 0),
      decisions: preferredDecisionReady
        ? normalizeMetadataDecisions(preferredDecisions).length
        : Number(preferred.stats?.decisions || a.stats?.decisions || b.stats?.decisions || 0),
    },
    reviewed: a.reviewed === true || b.reviewed === true,
  };
}

function normalizeManifestEntries(entries) {
  const byPath = new Map();
  for (const entry of entries || []) {
    if (!entry || !entry.path) continue;
    const current = byPath.get(entry.path);
    byPath.set(entry.path, current ? mergeManifestEntries(current, entry) : { ...entry });
  }
  return [...byPath.values()];
}

function changeTodoPriority(id, toPriority, insertIndex) {
  const todo = getTodoById(id);
  if (!todo) return;
  if (toPriority === 'WIP') {
    changeTodoStatus(id, 'WIP');
  }
  const fromPriority = todo.priority;
  const effectiveFromPriority = getTodoEffectivePriority(todo);
  const idx = todosManifest.indexOf(todo);
  if (idx >= 0) {
    todosManifest.splice(idx, 1);
  }

  const targetPriority = toPriority === 'WIP' ? (todo.priority || 'Medium') : toPriority;

  // Get the visible todos in target lane (excluding the moving one)
  const visibleTodos = todosManifest.filter(t => t.priority === targetPriority && isUserTask(t) && t.id !== id);

  let insertAt;
  if (typeof insertIndex === 'number' && insertIndex >= 0) {
    if (visibleTodos.length === 0) {
      // Lane is visually empty: append after the last item of targetPriority in the full manifest (if any)
      const allWithPriority = todosManifest.map((t, i) => ({ t, i })).filter(({ t }) => t.priority === targetPriority);
      const lastOfPriority = allWithPriority[allWithPriority.length - 1];
      insertAt = lastOfPriority ? lastOfPriority.i + 1 : todosManifest.length;
    } else {
      const clampedIdx = Math.min(insertIndex, visibleTodos.length);
      if (clampedIdx >= visibleTodos.length) {
        // Insert after the last visible card
        const lastVisible = visibleTodos[visibleTodos.length - 1];
        const lastIdx = todosManifest.indexOf(lastVisible);
        insertAt = lastIdx >= 0 ? lastIdx + 1 : todosManifest.length;
      } else {
        // Insert before the visible card at clampedIdx
        const targetVisible = visibleTodos[clampedIdx];
        const targetIdx = todosManifest.indexOf(targetVisible);
        insertAt = targetIdx >= 0 ? targetIdx : todosManifest.length;
      }
    }
  } else {
    // No insertIndex: append after the last item of targetPriority in the full manifest (if any)
    const allWithPriority = todosManifest.map((t, i) => ({ t, i })).filter(({ t }) => t.priority === targetPriority);
    const lastOfPriority = allWithPriority[allWithPriority.length - 1];
    insertAt = lastOfPriority ? lastOfPriority.i + 1 : todosManifest.length;
  }

  if (toPriority === 'Done' && fromPriority !== 'Done') {
    todo.originalPriority = effectiveFromPriority;
  } else if (fromPriority === 'Done' && toPriority !== 'Done') {
    delete todo.originalPriority;
  }
  if (toPriority !== 'WIP') {
    todo.priority = toPriority;
  }
  todo.modified = new Date().toISOString().slice(0, 10);
  todosManifest.splice(insertAt, 0, todo);
}

function changeTodoStatus(id, toStatus) {
  const todo = getTodoById(id);
  if (!todo) return;
  const nextStatus = toStatus === 'WIP' ? 'WIP' : '';
  if ((todo.status || '') === nextStatus) return;
  if (todo.priority === 'WIP') {
    todo.priority = getTodoEffectivePriority(todo);
    if (!todo.originalPriority || todo.originalPriority === 'WIP') todo.originalPriority = todo.priority;
  }
  todo.status = nextStatus;
  todo.modified = new Date().toISOString().slice(0, 10);
}

const METADATA_BUFFER_PATH = 'notes/metadata-buffer.json';
const METADATA_BUFFER_SCHEMA = 1;
const METADATA_SHARDS_DIR = 'notes/metadata-shards';
const METADATA_SHARDS_INDEX_PATH = `${METADATA_SHARDS_DIR}/index.json`;
const METADATA_SHARD_SWITCH_THRESHOLD = 20000;
const METADATA_SHARD_SIZE = 5000;
let metadataDecisionEntriesCache = [];
let metadataDecisionsByNoteId = new Map();
let metadataDecisionsByPath = new Map();
let metadataDecisionsByMajor = new Map();

function normalizeMetadataDecisionText(rawText) {
  if (!rawText) return '';
  let text = String(rawText);
  text = text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  text = text.replace(/\((?:reference|r[ée]f[ée]rence|supersedes|remplace)\s*:\s*"[^"]*"\)\s*$/i, '');
  text = text
    .replace(/^[\s*\-+]+(?:\s+|$)/, '')
    .replace(/^\d+[\.)]\s+/, '')
    .replace(/^"+|"+$/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function isMeaningfulMetadataDecisionText(text) {
  if (!text) return false;
  if (text.length < 4) return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  const punctuationNoise = text.replace(/[\p{L}\p{N}\s]/gu, '');
  if (punctuationNoise.length > 0 && punctuationNoise.length >= text.length * 0.6) return false;
  return true;
}

function normalizeMetadataDecisions(decisions) {
  const out = [];
  const seen = new Set();
  for (const entry of decisions || []) {
    const statusRaw = String(entry?.status || 'active').toLowerCase();
    const status = (statusRaw === 'superseded' || statusRaw === 'proposed') ? statusRaw : 'active';
    const text = normalizeMetadataDecisionText(entry?.text || '');
    if (!isMeaningfulMetadataDecisionText(text)) continue;
    const isLinked = !!entry?.isLinked;
    const major_topic_tags = Array.isArray(entry?.major_topic_tags)
      ? entry.major_topic_tags.map(x => String(x || '').trim()).filter(Boolean)
      : [];
    const authority = entry?.authority || '';
    const impact = entry?.impact || '';
    const rationale = entry?.rationale || entry?.context || '';
    const key = `${status}::${isLinked ? '1' : '0'}::${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, status, isLinked, major_topic_tags, authority, impact, rationale, context: rationale });
  }
  return out;
}

/** Extract decisions directly from the note's HTML (replaces the old Markdown regex parser). */
function extractDecisionsFromHTML(mainHTML) {
  const decisions = [];
  const doc = new DOMParser().parseFromString(`<div>${mainHTML || ''}</div>`, 'text/html');
  doc.querySelectorAll('.note-decision-wrapper').forEach(el => {
    const status = (el.getAttribute('data-decision-status') || 'active').trim().toLowerCase();
    const textEl = el.querySelector('.note-decision-text');
    let rawText = textEl ? textEl.textContent : (el.getAttribute('data-decision-text') || el.textContent || '');
    rawText = String(rawText || '').replace(/^!decision:\w+\s*/i, '').trim();
    const text = normalizeMetadataDecisionText(rawText);
    if (!isMeaningfulMetadataDecisionText(text)) return;
    const isLinked = el.hasAttribute('data-decision-ref') || el.classList.contains('decision-linked');
    const major_topic_tags = decodeTagListFromStorage(el.getAttribute('data-decision-major') || '');
    const authority = el.getAttribute('data-decision-authority') || '';
    const impact = el.getAttribute('data-decision-impact') || '';
    const rationale = el.getAttribute('data-decision-context') || '';
    decisions.push({ text, status, isLinked, major_topic_tags, authority, impact, rationale, context: rationale });
  });
  return normalizeMetadataDecisions(decisions);
}

function normalizeMetadataEntry(entry) {
  if (!entry || !entry.path) return null;
  const hasDecisionsField = Object.prototype.hasOwnProperty.call(entry, 'decisions');
  const normalizedDecisions = normalizeMetadataDecisions(hasDecisionsField ? entry.decisions : []);
  const decisionsReady = entry.decisionsReady === true || hasDecisionsField;
  const resolvedDecisionCount = decisionsReady
    ? normalizedDecisions.length
    : Number(entry.stats?.decisions || 0);
  return {
    id: entry.id || '',
    path: entry.path,
    title: entry.title || '',
    workstream: entry.workstream || '',
    workstreams: Array.isArray(entry.workstreams) ? [...entry.workstreams] : (entry.workstream ? entry.workstream.split(',').map(s => s.trim()).filter(Boolean) : []),
    group_tags: [...(entry.group_tags || [])],
    major_topic_tags: [...(entry.major_topic_tags || [])],
    topic_tags: [...(entry.topic_tags || [])],
    extra_tags: [...(entry.extra_tags || [])],
    date: entry.date || '',
    modified: entry.modified || '',
    preview: entry.preview || '',
    summary: entry.summary || '',
    decisionsReady,
    decisions: normalizedDecisions,
    stats: {
      todoMarkers: Number(entry.stats?.todoMarkers || 0),
      mentions: Number(entry.stats?.mentions || 0),
      decisions: resolvedDecisionCount,
    },
    reviewed: entry.reviewed === true,
  };
}

function manifestEntryToMetadata(entry) {
  return normalizeMetadataEntry({
    ...entry,
    preview: entry.preview || '',
    decisionsReady: entry.decisionsReady === true,
    decisions: entry.decisions || [],
    stats: entry.stats || { todoMarkers: 0, mentions: 0, decisions: 0 },
  });
}

function hasMetadataDecisionCoverage() {
  return metadataBuffer.some(item => item && item.decisionsReady === true);
}

function getAllMetadataDecisionEntries() {
  return metadataDecisionEntriesCache.slice();
}

function getMetadataDecisionEntriesForMajor(major) {
  const key = String(major || '').trim().toLowerCase();
  if (!key) return [];
  return (metadataDecisionsByMajor.get(key) || []).slice();
}

function getMetadataDecisionEntriesForNote(noteLike) {
  if (!noteLike) return [];
  if (noteLike.id && metadataDecisionsByNoteId.has(noteLike.id)) {
    return (metadataDecisionsByNoteId.get(noteLike.id) || []).slice();
  }
  if (noteLike.path && metadataDecisionsByPath.has(noteLike.path)) {
    return (metadataDecisionsByPath.get(noteLike.path) || []).slice();
  }
  return [];
}

function searchMetadataDecisionEntries(query, { major = '', status = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const source = major ? getMetadataDecisionEntriesForMajor(major) : metadataDecisionEntriesCache;
  let out = source;
  if (status) {
    const statusKey = String(status).trim().toLowerCase();
    out = out.filter(d => String(d.status || 'active').toLowerCase() === statusKey);
  }
  if (!q) return out.slice();
  return out.filter(d => {
    return (d.text || '').toLowerCase().includes(q) || (d.noteTitle || '').toLowerCase().includes(q);
  });
}

function isNoteDecisionMetadataReady(noteLike) {
  if (!noteLike) return false;
  const meta = (noteLike.id ? getMetaById(noteLike.id) : null)
    || (noteLike.path ? getMetaByPath(noteLike.path) : null)
    || null;
  return !!meta && meta.decisionsReady === true;
}

function syncMetadataIndexes() {
  metadataById = new Map();
  metadataByPath = new Map();
  for (const item of metadataBuffer) {
    if (!item) continue;
    if (item.id) metadataById.set(item.id, item);
    metadataByPath.set(item.path, item);
  }
  rebuildMetadataDecisionIndexes();
}

function rebuildMetadataDecisionIndexes() {
  metadataDecisionEntriesCache = [];
  metadataDecisionsByNoteId = new Map();
  metadataDecisionsByPath = new Map();
  metadataDecisionsByMajor = new Map();

  for (const item of metadataBuffer) {
    if (!item || item.decisionsReady !== true) continue;
    const localEntries = [];
    for (const d of item.decisions || []) {
      // A decision may carry its own major topic(s) (e.g. a project decision taken in a sync note
      // whose note-level major is a person). When present, those override the note's majors for
      // registry grouping; otherwise fall back to the note's major topics.
      const decMajors = (Array.isArray(d.major_topic_tags) && d.major_topic_tags.length)
        ? d.major_topic_tags
        : (item.major_topic_tags || []);
      const entry = {
        text: d.text,
        status: d.status || 'active',
        isLinked: !!d.isLinked,
        authority: d.authority || '',
        impact: d.impact || '',
        rationale: d.rationale || d.context || '',
        context: d.rationale || d.context || '',
        noteId: item.id || '',
        noteTitle: item.title || item.path.split('/').pop().replace('.html', ''),
        notePath: item.path,
        date: item.date || '',
        major_topic_tags: decMajors,
        topic_tags: item.topic_tags || [],
      };
      localEntries.push(entry);
      metadataDecisionEntriesCache.push(entry);
      for (const major of decMajors) {
        const key = String(major || '').trim().toLowerCase();
        if (!key) continue;
        if (!metadataDecisionsByMajor.has(key)) metadataDecisionsByMajor.set(key, []);
        metadataDecisionsByMajor.get(key).push(entry);
      }
    }
    if (item.id) metadataDecisionsByNoteId.set(item.id, localEntries);
    metadataDecisionsByPath.set(item.path, localEntries);
  }
}

function metadataShardFileName(index) {
  return `metadata-${String(index).padStart(4, '0')}.json`;
}

function metadataShardSignature(items) {
  const src = JSON.stringify(items || []);
  let h1 = 0xdeadbeef ^ 2166136261;
  let h2 = 0x41c6ce57 ^ 2166136261;
  for (let i = 0; i < src.length; i++) {
    const ch = src.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function mergeManifestWithExistingMetadata(entries) {
  return (entries || []).map(entry => {
    const existing = getMetaByPath(entry.path) || (entry.id ? getMetaById(entry.id) : null) || {};
    return manifestEntryToMetadata({
      ...existing,
      ...entry,
      preview: existing.preview || entry.preview || '',
      stats: existing.stats || entry.stats || { todoMarkers: 0, mentions: 0, decisions: 0 },
    });
  }).filter(Boolean);
}

async function loadMetadataShards() {
  if (!await StorageAPI.hasMetadataShardsIndex()) return false;
  try {
    const parsedIndex = await StorageAPI.readMetadataShardsIndex();
    const version = Number(parsedIndex?.version || 0);
    if (version !== METADATA_BUFFER_SCHEMA) return false;
    const shardFiles = Array.isArray(parsedIndex?.shardFiles) ? parsedIndex.shardFiles : [];
    if (!shardFiles.length) return false;

    const items = [];
    for (const shardFile of shardFiles) {
      const shardPath = `${METADATA_SHARDS_DIR}/${shardFile}`;
      if (!await StorageAPI.hasNoteContent(shardPath)) return false;
      const parsedShard = await StorageAPI.readMetadataShard(shardFile);
      const shardItems = Array.isArray(parsedShard?.items) ? parsedShard.items : [];
      for (const item of shardItems) {
        const normalized = normalizeMetadataEntry(item);
        if (normalized) items.push(normalized);
      }
    }

    metadataVersion = version;
    metadataShardIndexCache = parsedIndex;
    metadataBuffer = normalizeManifestEntries(items);
    metadataStorageMode = 'sharded';
    perfTelemetry.sharding.mode = 'sharded';
    syncMetadataIndexes();
    manifest = metadataBuffer.map(item => ({ ...item }));
    return true;
  } catch (e) {
    console.warn('Could not load metadata shards', e);
    return false;
  }
}

async function loadMetadataBuffer() {
  const loadedSharded = await loadMetadataShards();
  if (loadedSharded) return true;
  if (!await StorageAPI.hasMetadataBuffer()) return false;
  try {
    const parsed = await StorageAPI.readMetadataBuffer();
    const version = Number(parsed?.version || 0);
    if (version !== METADATA_BUFFER_SCHEMA || !Array.isArray(parsed?.items)) {
      return false;
    }
    metadataVersion = version;
    metadataShardIndexCache = null;
    metadataBuffer = normalizeManifestEntries(parsed.items.map(normalizeMetadataEntry).filter(Boolean));
    metadataStorageMode = 'single';
    perfTelemetry.sharding.mode = 'single';
    syncMetadataIndexes();
    manifest = metadataBuffer.map(item => ({ ...item }));
    return true;
  } catch (e) {
    console.warn('Could not load metadata buffer', e);
    return false;
  }
}

async function cleanupMetadataShards(indexData = null) {
  try {
    const index = indexData || (await StorageAPI.hasMetadataShardsIndex()
      ? await StorageAPI.readMetadataShardsIndex()
      : null);
    const shardFiles = Array.isArray(index?.shardFiles) ? index.shardFiles : [];
    for (const shardFile of shardFiles) {
      try {
        await StorageAPI.deleteMetadataShard(shardFile);
        perfTelemetry.sharding.shardsDeleted += 1;
      } catch (e) {
        // Ignore missing files.
      }
    }
    try {
      await StorageAPI.deleteMetadataShardsIndex();
      perfTelemetry.sharding.shardsDeleted += 1;
    } catch (e) {
      // Ignore missing index.
    }
  } catch (e) {
    console.warn('Could not cleanup metadata shards', e);
  }
}

async function saveMetadataShards() {
  metadataBuffer = normalizeManifestEntries(metadataBuffer.map(normalizeMetadataEntry).filter(Boolean));
  syncMetadataIndexes();

  const shardSize = METADATA_SHARD_SIZE;
  const previousIndex = metadataShardIndexCache || (await StorageAPI.hasMetadataShardsIndex()
    ? await StorageAPI.readMetadataShardsIndex()
    : null);
  const previousMetaByFile = new Map();
  const previousFiles = Array.isArray(previousIndex?.shardFiles) ? previousIndex.shardFiles : [];
  const previousShardMeta = Array.isArray(previousIndex?.shards) ? previousIndex.shards : [];
  for (const item of previousShardMeta) {
    if (item?.file) previousMetaByFile.set(item.file, item);
  }

  const shardFiles = [];
  const nextShardMeta = [];
  let changedShardWrites = 0;
  for (let i = 0; i < metadataBuffer.length; i += shardSize) {
    const shardIndex = Math.floor(i / shardSize);
    const shardFile = metadataShardFileName(shardIndex);
    const shardPath = `${METADATA_SHARDS_DIR}/${shardFile}`;
    const shardItems = metadataBuffer.slice(i, i + shardSize);
    const signature = metadataShardSignature(shardItems);
    const prevMeta = previousMetaByFile.get(shardFile);
    const unchanged = prevMeta && prevMeta.signature === signature && Number(prevMeta.count || 0) === shardItems.length;

    if (!unchanged) {
      const shardPayload = {
        version: METADATA_BUFFER_SCHEMA,
        shard: shardIndex,
        updatedAt: new Date().toISOString(),
        items: shardItems,
      };
      broadcastSync({ type: 'WILL_WRITE', file: shardPath });
      await StorageAPI.writeMetadataShard(shardFile, shardPayload);
      broadcastSync({ type: 'WRITE_DONE', file: shardPath });
      perfTelemetry.sharding.shardsWritten += 1;
      changedShardWrites += 1;
    }

    const shardPayload = {
      file: shardFile,
      count: shardItems.length,
      signature,
    };
    nextShardMeta.push(shardPayload);
    shardFiles.push(shardFile);
  }

  for (const oldFile of previousFiles) {
    if (!shardFiles.includes(oldFile)) {
      try {
        await StorageAPI.deleteMetadataShard(oldFile);
        perfTelemetry.sharding.shardsDeleted += 1;
      } catch (e) {
        // Ignore missing stale files.
      }
    }
  }

  const indexPayload = {
    version: METADATA_BUFFER_SCHEMA,
    updatedAt: new Date().toISOString(),
    total: metadataBuffer.length,
    shardSize,
    shardFiles,
    shards: nextShardMeta,
  };
  broadcastSync({ type: 'WILL_WRITE', file: METADATA_SHARDS_INDEX_PATH });
  await StorageAPI.writeMetadataShardsIndex(indexPayload);
  broadcastSync({ type: 'WRITE_DONE', file: METADATA_SHARDS_INDEX_PATH });
  perfTelemetry.sharding.indexWrites += 1;
  if (changedShardWrites > 0 && changedShardWrites < shardFiles.length) perfTelemetry.sharding.partialRewriteCount += 1;
  else if (changedShardWrites >= shardFiles.length && shardFiles.length > 0) perfTelemetry.sharding.fullRewriteCount += 1;
  metadataShardIndexCache = indexPayload;
  metadataStorageMode = 'sharded';
  perfTelemetry.sharding.mode = 'sharded';
}

async function saveMetadataBuffer() {
  metadataBuffer = normalizeManifestEntries(metadataBuffer.map(normalizeMetadataEntry).filter(Boolean));
  syncMetadataIndexes();

  if (metadataBuffer.length > METADATA_SHARD_SWITCH_THRESHOLD) {
    await saveMetadataShards();
    return;
  }

  const payload = {
    version: METADATA_BUFFER_SCHEMA,
    updatedAt: new Date().toISOString(),
    items: metadataBuffer,
  };
  if (metadataStorageMode === 'sharded' || await StorageAPI.hasMetadataShardsIndex()) {
    await cleanupMetadataShards(metadataShardIndexCache);
    metadataShardIndexCache = null;
  }
  broadcastSync({ type: 'WILL_WRITE', file: METADATA_BUFFER_PATH });
  await StorageAPI.writeMetadataBuffer(payload);
  broadcastSync({ type: 'WRITE_DONE', file: METADATA_BUFFER_PATH });
  metadataStorageMode = 'single';
  perfTelemetry.sharding.mode = 'single';
}

function getMetaPage(page = 0, pageSize = 200) {
  const start = Math.max(0, page) * Math.max(1, pageSize);
  const end = start + Math.max(1, pageSize);
  return metadataBuffer.slice(start, end);
}

function getMetaById(noteId) {
  if (!noteId) return null;
  return (typeof metadataById !== 'undefined' && metadataById) ? (metadataById.get(noteId) || null) : null;
}

function getMetaByPath(path) {
  if (!path) return null;
  if (typeof metadataByPath === 'undefined' || !metadataByPath) return null;
  const direct = metadataByPath.get(path);
  if (direct) return direct;
  const norm = String(path).replace(/\\/g, '/').replace(/^\/+/, '').trim();
  return metadataByPath.get(norm) || null;
}

async function getNoteHtmlOnDemand(path) {
  return await StorageAPI.readNoteContent(path);
}

function upsertMeta(meta) {
  if (!meta) return;
  const idx = metadataBuffer.findIndex(m => m.path === meta.path || (meta.id && m.id === meta.id));
  const hasDecisions = Object.prototype.hasOwnProperty.call(meta, 'decisions');
  const hasDecisionReady = Object.prototype.hasOwnProperty.call(meta, 'decisionsReady');

  if (idx >= 0) {
    const base = metadataBuffer[idx] || {};
    const mergedRaw = { ...base, ...meta };
    if (!hasDecisions) mergedRaw.decisions = base.decisions || [];
    if (!hasDecisionReady) mergedRaw.decisionsReady = base.decisionsReady === true;
    const normalized = normalizeMetadataEntry(mergedRaw);
    if (normalized) metadataBuffer[idx] = normalized;
  } else {
    const normalized = normalizeMetadataEntry(meta);
    if (!normalized) return;
    metadataBuffer.push(normalized);
  }
  metadataBuffer = normalizeManifestEntries(metadataBuffer);
  syncMetadataIndexes();
}

async function hydrateMetadataFromManifestIncremental({ chunkSize = 100 } = {}) {
  const normalizedChunk = Math.max(10, Number(chunkSize) || 100);
  let sourceEntries = manifest;
  try {
    sourceEntries = normalizeManifestEntries(await StorageAPI.readNotesManifest());
  } catch (e) {
    // Fall back to in-memory list when canonical manifest file is missing.
  }

  metadataHydrationProgress = { done: 0, total: sourceEntries.length, running: true };
  let dirty = false;
  for (let i = 0; i < sourceEntries.length; i += normalizedChunk) {
    const chunk = sourceEntries.slice(i, i + normalizedChunk);
    for (const entry of chunk) {
      if (!entry?.path) continue;
      const current = getMetaByPath(entry.path);
      const alreadyFresh = current && current.modified && current.modified === entry.modified && current.decisionsReady === true;
      if (alreadyFresh) {
        metadataHydrationProgress.done += 1;
        continue;
      }

      let preview = current?.preview || '';
      let decisions = current?.decisions || [];
      let decisionsReady = current?.decisionsReady === true;
      let stats = current?.stats || { todoMarkers: 0, mentions: 0, decisions: 0 };
      let parsedSummary = current?.summary || entry.summary || '';
      let parsed = null;
      try {
        const html = await getNoteHtmlOnDemand(entry.path);
        parsed = parseNoteHTML(html);
        parsedSummary = parsed.summary || parsedSummary;
        const previewData = extractNotePreviewData(parsed.mainHTML || '');
        preview = previewData?.text || '';
        decisions = extractDecisionsFromHTML(parsed.mainHTML || '');
        decisionsReady = true;
        stats = {
          todoMarkers: (parsed.mainHTML || '').match(/data-todo-id=/g)?.length || 0,
          mentions: (parsed.mainHTML || '').match(/class="pill-mention"/g)?.length || 0,
          decisions: decisions.length,
        };
      } catch (e) {
        // Keep previous lightweight values on read error.
      }

      let effectiveTitle = entry.title || current?.title || '';
      const isDummy = (t, id) => !t || t === id || t === 'Untitled' || t === 'Untitled Note' || /^\d{4}-\d{2}-\d{2}(-\d+)?$/.test(t) || /^note[-_]/.test(t);
      if (isDummy(effectiveTitle, entry.id) && parsed?.title && !isDummy(parsed.title, entry.id)) {
        effectiveTitle = parsed.title;
      }

      upsertMeta({
        ...entry,
        title: effectiveTitle,
        preview,
        decisions,
        decisionsReady,
        stats,
        summary: parsedSummary,
      });
      dirty = true;
      metadataHydrationProgress.done += 1;
    }

    if (dirty) {
      manifest = metadataBuffer.map(item => ({ ...item }));
      await saveMetadataBuffer();
      if (typeof refreshDecisionListFromMetadataIfAvailable === 'function') {
        refreshDecisionListFromMetadataIfAvailable();
      }
      dirty = false;
    }

    await new Promise(resolve => setTimeout(resolve, 0));
  }

  metadataHydrationProgress.running = false;
}
// ═══ Manifest helpers ═══
async function loadManifest() {
  const loadedMeta = await loadMetadataBuffer();
  if (loadedMeta) return;
  try {
    manifest = normalizeManifestEntries(await StorageAPI.readNotesManifest());
  } catch {
    manifest = [];
  }
  metadataBuffer = mergeManifestWithExistingMetadata(manifest);
  syncMetadataIndexes();
}

let _saveManifestTimer = null;
let _saveManifestResolveQueue = [];

async function _doSaveManifestDirect() {
  manifest = normalizeManifestEntries(manifest);
  broadcastSync({ type: 'WILL_WRITE', file: 'notes/manifest.json' });
  await StorageAPI.writeNotesManifest(manifest);
  broadcastSync({ type: 'WRITE_DONE', file: 'notes/manifest.json' });

  // Keep notes/manifest.js in sync
  try {
    const jsContent = `window.MANIFEST_DATA = ${safeJSON(manifest)};`;
    broadcastSync({ type: 'WILL_WRITE', file: 'notes/manifest.js' });
    await StorageAPI.writeNotesManifestJS(jsContent);
    broadcastSync({ type: 'WRITE_DONE', file: 'notes/manifest.js' });
  } catch (e) {
    console.warn('Could not write notes/manifest.js:', e.message);
  }

  metadataBuffer = mergeManifestWithExistingMetadata(manifest);
  try {
    await saveMetadataBuffer();
  } catch (e) {
    console.warn('Could not write metadata buffer:', e.message);
  }

  broadcastSync({ type: 'MANIFEST_UPDATED' });
}

async function saveManifest(options = {}) {
  if (options && options.force) {
    if (_saveManifestTimer) {
      clearTimeout(_saveManifestTimer);
      _saveManifestTimer = null;
    }
    const resolves = _saveManifestResolveQueue;
    _saveManifestResolveQueue = [];
    await _doSaveManifestDirect();
    for (const r of resolves) r();
    return;
  }

  if (_saveManifestTimer) clearTimeout(_saveManifestTimer);

  return new Promise((resolve) => {
    _saveManifestResolveQueue.push(resolve);
    _saveManifestTimer = setTimeout(async () => {
      _saveManifestTimer = null;
      const resolves = _saveManifestResolveQueue;
      _saveManifestResolveQueue = [];
      try {
        await _doSaveManifestDirect();
      } finally {
        for (const r of resolves) r();
      }
    }, 2000); // 2 second debounce
  });
}

function getNoteById(id) {
  if (!id) return null;
  const rawId = String(id).replace(/\\/g, '/').trim();
  if (!rawId) return null;
  const cleanId = rawId.replace(/^notes\//i, '').replace(/\.html$/i, '');
  const cleanPath = rawId.startsWith('notes/') ? rawId : (rawId.endsWith('.html') ? ('notes/' + rawId.replace(/^notes\//i, '')) : ('notes/' + rawId + '.html'));
  return (typeof getMetaById === 'function' ? getMetaById(rawId) : null)
    || (cleanId !== rawId && typeof getMetaById === 'function' ? getMetaById(cleanId) : null)
    || (typeof getMetaByPath === 'function' ? getMetaByPath(rawId) : null)
    || (typeof getMetaByPath === 'function' ? getMetaByPath(cleanPath) : null)
    || (typeof manifest !== 'undefined' && Array.isArray(manifest) ? manifest.find(n => n && (n.id === rawId || n.id === cleanId || n.path === rawId || n.path === cleanPath || n.path?.replace(/\\/g, '/') === cleanPath)) : null)
    || (typeof window !== 'undefined' && Array.isArray(window.manifest) ? window.manifest.find(n => n && (n.id === rawId || n.id === cleanId || n.path === rawId || n.path === cleanPath || n.path?.replace(/\\/g, '/') === cleanPath)) : null)
    || (typeof globalThis !== 'undefined' && Array.isArray(globalThis.manifest) ? globalThis.manifest.find(n => n && (n.id === rawId || n.id === cleanId || n.path === rawId || n.path === cleanPath || n.path?.replace(/\\/g, '/') === cleanPath)) : null)
    || (typeof currentNote !== 'undefined' && currentNote && (currentNote.id === rawId || currentNote.id === cleanId || currentNote.path === rawId || currentNote.path === cleanPath) ? currentNote : null)
    || (typeof window !== 'undefined' && window.currentNote && (window.currentNote.id === rawId || window.currentNote.id === cleanId || window.currentNote.path === rawId || window.currentNote.path === cleanPath) ? window.currentNote : null)
    || (typeof globalThis !== 'undefined' && globalThis.currentNote && (globalThis.currentNote.id === rawId || globalThis.currentNote.id === cleanId || globalThis.currentNote.path === rawId || globalThis.currentNote.path === cleanPath) ? globalThis.currentNote : null)
    || null;
}
function getNoteByPath(path) {
  if (!path) return null;
  const rawPath = String(path).replace(/\\/g, '/').trim();
  if (!rawPath) return null;
  const cleanPath = rawPath.startsWith('notes/') ? rawPath : (rawPath.endsWith('.html') ? ('notes/' + rawPath.replace(/^notes\//i, '')) : ('notes/' + rawPath + '.html'));
  const cleanId = rawPath.replace(/^notes\//i, '').replace(/\.html$/i, '');
  return getMetaByPath(rawPath)
    || (cleanPath !== rawPath ? getMetaByPath(cleanPath) : null)
    || getMetaById(cleanId)
    || (Array.isArray(manifest) ? manifest.find(n => n && (n.path === rawPath || n.path === cleanPath || n.id === cleanId || n.id === rawPath || n.path?.replace(/\\/g, '/') === cleanPath)) : null)
    || null;
}
window.getNoteById = getNoteById;
if (typeof globalThis !== 'undefined') globalThis.getNoteById = getNoteById;
window.getNoteByPath = getNoteByPath;
if (typeof globalThis !== 'undefined') globalThis.getNoteByPath = getNoteByPath;

function upsertManifest(note) {
  let preview = '';
  let decisions = [];
  let decisionsReady = false;
  let stats = { todoMarkers: 0, mentions: 0, decisions: 0 };
  if (typeof note.mainHTML === 'string') {
    const previewData = extractNotePreviewData(note.mainHTML || '');
    preview = previewData?.text || '';
    decisions = extractDecisionsFromHTML(note.mainHTML || '');
    decisionsReady = true;
    stats = {
      todoMarkers: (note.mainHTML || '').match(/data-todo-id=/g)?.length || 0,
      mentions: (note.mainHTML || '').match(/class="pill-mention"/g)?.length || 0,
      decisions: decisions.length,
    };
  }

  const existing = manifest.find(m => m.path === note.path || (note.id && m.id === note.id)) || {};
  const entry = {
    id: note.id || '',
    title: note.title,
    path: note.path,
    workstream: note.workstream || '',
    workstreams: Array.isArray(note.workstreams) ? note.workstreams : (note.workstream ? note.workstream.split(',').map(s => s.trim()).filter(Boolean) : []),
    group_tags: note.group_tags || [],
    major_topic_tags: note.major_topic_tags || [],
    topic_tags: note.topic_tags || [],
    extra_tags: note.extra_tags || [],
    date: note.date || '',
    modified: new Date().toISOString(),
    preview,
    // summary_text: plain-text cache for fast board loading; summaryHTML stored in note file
    summary: htmlToPlainText(note.summary ?? existing.summary ?? ''),
    decisionsReady,
    decisions,
    stats,
    reviewed: note.reviewed || false,
  };
  const idx = manifest.findIndex(m => m.path === entry.path || (entry.id && m.id === entry.id));
  if (idx >= 0) manifest[idx] = { ...(manifest[idx] || {}), ...entry };
  else manifest.push(entry);
  manifest = normalizeManifestEntries(manifest);
  upsertMeta(entry);
  if (typeof refreshDecisionListFromMetadataIfAvailable === 'function') {
    refreshDecisionListFromMetadataIfAvailable();
  }
}

function normalizeLabelList(values) {
  return [...new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))];
}

// Tag lists (group/major/topic/extra, and per-decision data-decision-major) are stored comma-separated
// in note <meta> tags and DOM attributes. A tag value that itself contains a comma would be split into
// two on read; escape literal commas as %2C so values round-trip intact. Backward compatible: values
// without commas serialize and parse exactly as before, so existing notes are unaffected.
function encodeTagListToStorage(arr) {
  return (arr || [])
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .map(v => v.replace(/,/g, '%2C'))
    .join(', ');
}
function decodeTagListFromStorage(str) {
  return String(str || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/%2C/gi, ','));
}

function buildEditableNoteData(parsed, entry) {
  return {
    id: parsed.id || entry?.id || '',
    title: parsed.title || entry?.title || '',
    date: entry?.date || '',
    group_tags: [...(parsed.group_tags || [])],
    major_topic_tags: [...(parsed.major_topic_tags || [])],
    topic_tags: [...(parsed.topic_tags || [])],
    extra_tags: [...(parsed.extra_tags || [])],
    mainHTML: parsed.mainHTML || '',
    summary: parsed.summary || entry?.summary || '',
  };
}

function injectNoteIdMeta(html, noteId) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let el = doc.querySelector('meta[name="note-id"]');
  if (!el) {
    el = doc.createElement('meta');
    el.setAttribute('name', 'note-id');
    doc.head.insertBefore(el, doc.head.firstChild);
  }
  el.setAttribute('content', noteId);
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

async function ensureNoteStoragePaths() {
  let changed = false;
  for (const entry of manifest) {
    if (!entry?.path) continue;
    const oldPath = entry.path;
    let html = null;
    let noteId = entry.id || '';

    try {
      const oldExists = await StorageAPI.hasNoteContent(oldPath);

      if (!noteId) {
        if (!oldExists) {
          console.warn('Could not normalize note storage path', oldPath, new Error('Note file missing'));
          continue;
        }
        html = await StorageAPI.readNoteContent(oldPath);
        const parsed = parseNoteHTML(html);
        noteId = parsed.id || generateNoteId();
        entry.id = noteId;
        if (!parsed.id) {
          html = injectNoteIdMeta(html, noteId);
          await StorageAPI.writeNoteContent(oldPath, html);
        }
        changed = true;
      }

      const targetPath = getCanonicalNotePath(noteId);
      const targetExists = oldPath !== targetPath ? await StorageAPI.hasNoteContent(targetPath) : false;

      // Some manifests still point at pre-migration paths; keep the canonical
      // note-id file if it already exists on disk.
      if (oldPath !== targetPath && targetExists) {
        entry.path = targetPath;
        if (currentNote?.path === oldPath) {
          currentNote.path = targetPath;
          currentNote.id = noteId;
        }
        changed = true;
        if (oldExists) {
          console.warn('Legacy note path still exists alongside canonical path', oldPath, '→', targetPath);
        }
        continue;
      }

      if (oldPath !== targetPath) {
        if (!oldExists) throw new Error(`Note file missing: ${oldPath}`);
        if (!html) html = await StorageAPI.readNoteContent(oldPath);
        await StorageAPI.writeNoteContent(targetPath, html);
        try { await StorageAPI.deleteNoteContent(oldPath); } catch (e) { console.warn('Could not delete old note path', oldPath, e); }
        entry.path = targetPath;
        if (currentNote?.path === oldPath) {
          currentNote.path = targetPath;
          currentNote.id = noteId;
          currentNote.originalHTML = html;
        }
        changed = true;
      } else if (currentNote?.path === oldPath) {
        currentNote.id = noteId;
      }
    } catch (e) {
      console.warn('Could not normalize note storage path', oldPath, e);
    }
  }

  if (changed) {
    await saveManifest({ force: true });
    await rebuildIndexHTML();
  }
  return changed;
}

async function updateNoteAtPath(path, transform) {
  const html = await StorageAPI.readNoteContent(path);
  const parsed = parseNoteHTML(html);
  const entry = manifest.find(m => m.path === path);
  const base = buildEditableNoteData(parsed, entry);
  const next = await transform({ ...base }, parsed, entry);
  if (!next) return false;

  const normalized = {
    title: next.title ?? base.title,
    date: next.date ?? base.date,
    group_tags: normalizeLabelList(next.group_tags ?? base.group_tags),
    major_topic_tags: normalizeLabelList(next.major_topic_tags ?? base.major_topic_tags),
    topic_tags: normalizeLabelList(next.topic_tags ?? base.topic_tags),
    extra_tags: normalizeLabelList(next.extra_tags ?? base.extra_tags),
    mainHTML: next.mainHTML ?? base.mainHTML,
    summary: next.summary ?? base.summary,
  };

  const updatedHTML = applyNoteEdits(html, normalized);
  await StorageAPI.writeNoteContent(path, updatedHTML);
  upsertManifest({
    id: base.id,
    title: normalized.title,
    path,
    group_tags: normalized.group_tags,
    major_topic_tags: normalized.major_topic_tags,
    topic_tags: normalized.topic_tags,
    extra_tags: normalized.extra_tags,
    date: normalized.date,
    summary: normalized.summary,
  });

  if (currentNote?.path === path) {
    currentNote = {
      ...currentNote,
      id: base.id || entry?.id || currentNote.id || '',
      title: normalized.title,
      date: normalized.date,
      group_tags: normalized.group_tags,
      major_topic_tags: normalized.major_topic_tags,
      topic_tags: normalized.topic_tags,
      extra_tags: normalized.extra_tags,
      originalHTML: updatedHTML,
      mainHTML: normalized.mainHTML,
      summary: normalized.summary,
    };
    if (document.getElementById('note-edit-overlay')?.style.display !== 'none' &&
      document.querySelector('.overlay-panel')?.classList.contains('overlay-view-mode')) {
      setOverlayViewMode(true);
    }
  }
  broadcastSync({ type: 'NOTE_SAVED', noteId: base.id || entry?.id || '', path, modified: new Date().toISOString() });
  return true;
}

function getNotesByLabel(type, label) {
  const field = getLabelField(type);
  return manifest.filter(n => (n[field] || []).includes(label));
}

function getSplitBuckets(sourceType, sourceLabel, partitionType) {
  const partitionField = getLabelField(partitionType);
  const notes = getNotesByLabel(sourceType, sourceLabel);
  const buckets = new Map();
  for (const note of notes) {
    const values = normalizeLabelList(note[partitionField]);
    const bucketValues = values.length ? values : ['(Untagged)'];
    for (const value of bucketValues) {
      if (!buckets.has(value)) buckets.set(value, []);
      buckets.get(value).push(note);
    }
  }
  return [...buckets.entries()].sort((a, b) => {
    if (a[0] === '(Untagged)') return 1;
    if (b[0] === '(Untagged)') return -1;
    return a[0].localeCompare(b[0]);
  });
}

async function renameLabelAcrossNotes(type, fromLabel, toLabel) {
  const source = String(fromLabel || '').trim();
  const target = String(toLabel || '').trim();
  if (!source || !target) throw new Error('Label name is required');
  if (source === target) return 0;
  const notes = getNotesByLabel(type, source);
  let changed = 0;
  for (const note of notes) {
    const ok = await updateNoteAtPath(note.path, data => {
      const field = getLabelField(type);
      const next = normalizeLabelList(data[field]);
      if (!next.includes(source)) return null;
      const replaced = normalizeLabelList(next.map(v => v === source ? target : v));
      if (replaced.join('\u0000') === next.join('\u0000')) return null;
      data[field] = replaced;
      return data;
    });
    if (ok) changed++;
  }
  if (changed) await saveManifest({ force: true });
  return changed;
}

async function mergeLabelAcrossNotes(type, sourceLabel, targetLabel) {
  return renameLabelAcrossNotes(type, sourceLabel, targetLabel);
}

async function promoteLabelAcrossNotes(sourceType, label, targetType, targetLabel = label) {
  const source = String(label || '').trim();
  const target = String(targetLabel || '').trim();
  if (!source) throw new Error('Label name is required');
  if (!target) throw new Error('Target label is required');
  if (sourceType === targetType) throw new Error('Choose a different target type');
  const sourceField = getLabelField(sourceType);
  const targetField = getLabelField(targetType);
  const notes = getNotesByLabel(sourceType, source);
  let changed = 0;
  for (const note of notes) {
    const ok = await updateNoteAtPath(note.path, data => {
      const src = normalizeLabelList(data[sourceField]);
      if (!src.includes(source)) return null;
      const nextSource = src.filter(v => v !== source);
      const nextTarget = normalizeLabelList([...(data[targetField] || []), target]);
      if (nextSource.join('\u0000') === src.join('\u0000') && nextTarget.join('\u0000') === normalizeLabelList(data[targetField]).join('\u0000')) return null;
      data[sourceField] = nextSource;
      data[targetField] = nextTarget;
      return data;
    });
    if (ok) changed++;
  }
  if (changed) await saveManifest({ force: true });
  return changed;
}

async function splitLabelAcrossNotes(sourceType, sourceLabel, partitionType, bucketMappings) {
  const source = String(sourceLabel || '').trim();
  if (!source) throw new Error('Label name is required');
  const sourceField = getLabelField(sourceType);
  const partitionField = getLabelField(partitionType);
  const notes = getNotesByLabel(sourceType, source);
  let changed = 0;

  for (const note of notes) {
    const ok = await updateNoteAtPath(note.path, data => {
      const currentSource = normalizeLabelList(data[sourceField]);
      if (!currentSource.includes(source)) return null;
      const partitionValues = normalizeLabelList(data[partitionField]);
      const bucketValues = partitionValues.length ? partitionValues : ['(Untagged)'];
      const nextSource = new Set(currentSource);
      const additions = new Set();
      let keepSource = false;

      for (const bucketValue of bucketValues) {
        const targetLabel = String(bucketMappings[bucketValue] || '').trim();
        if (!targetLabel || targetLabel === source) {
          keepSource = true;
          continue;
        }
        additions.add(targetLabel);
      }

      if (!keepSource && additions.size) nextSource.delete(source);
      for (const label of additions) nextSource.add(label);

      const nextList = [...nextSource];
      if (nextList.join('\u0000') === currentSource.join('\u0000')) return null;
      data[sourceField] = nextList;
      return data;
    });
    if (ok) changed++;
  }

  if (changed) await saveManifest({ force: true });
  return changed;
}

async function removeLabelAcrossNotes(type, label) {
  const source = String(label || '').trim();
  if (!source) throw new Error('Label name is required');
  const field = getLabelField(type);
  const notes = getNotesByLabel(type, source);
  let changed = 0;
  for (const note of notes) {
    const ok = await updateNoteAtPath(note.path, data => {
      const next = normalizeLabelList(data[field]).filter(v => v !== source);
      const current = normalizeLabelList(data[field]);
      if (next.join('\u0000') === current.join('\u0000')) return null;
      data[field] = next;
      return data;
    });
    if (ok) changed++;
  }
  if (changed) await saveManifest({ force: true });
  return changed;
}

// ═══ Note HTML: parse + surgical update ═══

/** Parse a note's HTML to extract editable fields. */
function parseNoteHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const getMeta = name => {
    const c = doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || '';
    return c ? decodeTagListFromStorage(c) : [];
  };
  // Summary: prefer the dedicated <section id="note-summary">, fall back to legacy <meta> for old notes
  const summarySection = doc.querySelector('section#note-summary');
  const summaryHTML = summarySection
    ? summarySection.innerHTML.trim()
    : (doc.querySelector('meta[name="summary"]')?.getAttribute('content') || '');
  let mainHTML = doc.querySelector('main')?.innerHTML?.trim() || '';
  if (!mainHTML && doc.body) {
    const bodyClone = doc.body.cloneNode(true);
    bodyClone.querySelectorAll('header, nav, section#note-summary, script, style').forEach(el => el.remove());
    mainHTML = bodyClone.innerHTML.trim();
  }
  let title = doc.querySelector('title')?.textContent?.trim() || '';
  if (!title) {
    title = doc.querySelector('meta[name="title"]')?.getAttribute('content')?.trim() || '';
  }
  if (!title) {
    title = doc.querySelector('h1.title, h1#note-title, header h1, h1')?.textContent?.trim() || '';
  }
  return {
    id: doc.querySelector('meta[name="note-id"]')?.getAttribute('content') || '',
    title,
    group_tags: getMeta('group-tags'),
    major_topic_tags: getMeta('major-topic-tags'),
    topic_tags: getMeta('topic-tags'),
    extra_tags: getMeta('extra-tags'),
    mainHTML: mainHTML,
    workstream: doc.querySelector('meta[name="workstream"]')?.getAttribute('content') || '',
    workstreams: (() => {
      const metas = [...doc.querySelectorAll('meta[name="workstream"], meta[name="workstreams"]')];
      const all = [];
      metas.forEach(m => {
        const c = m.getAttribute('content');
        if (c) c.split(',').forEach(s => {
          const trimmed = s.trim();
          if (trimmed && !all.includes(trimmed)) all.push(trimmed);
        });
      });
      return all;
    })(),
    reviewed: doc.querySelector('meta[name="reviewed"]')?.getAttribute('content') === 'true',
    summary: summaryHTML,
  };
}

function normalizePreviewText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncatePreviewText(value, max = 120) {
  const text = normalizePreviewText(value);
  if (!text) return '';
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return chars.slice(0, Math.max(0, max - 1)).join('').trimEnd() + '…';
}

function isSentenceLikeHighlight(text) {
  const normalized = normalizePreviewText(text);
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount < 3) return false;
  return /[.!?]\s*$/.test(normalized) || normalized.length >= 20 || wordCount >= 3;
}

function extractNotePreviewData(mainHTML) {
  const doc = new DOMParser().parseFromString(`<div>${mainHTML || ''}</div>`, 'text/html');
  const highlights = [];
  doc.querySelectorAll('mark, .note-highlight').forEach(node => {
    const text = normalizePreviewText(node.textContent);
    if (isSentenceLikeHighlight(text)) highlights.push(text);
  });
  const seen = new Set();
  const uniqueHighlights = [];
  for (const text of highlights) {
    if (seen.has(text)) continue;
    seen.add(text);
    uniqueHighlights.push(text);
  }
  return {
    text: truncatePreviewText(doc.body.textContent || '', 320),
    highlights: uniqueHighlights,
  };
}

function buildNoteHighlightSectionHTML(highlights, { compact = false, label = null, showAll = false } = {}) {
  const items = [...(highlights || [])].map(normalizePreviewText).filter(Boolean);
  if (!items.length) return '';
  const sectionLabel = label != null ? label : (typeof t === 'function' ? t('board.highlights') : 'Highlights');

  if (showAll) {
    // Render all highlights as stacked items (full text) so they can fill the card height.
    const itemsHTML = items.map(text => `<div class="note-highlight" title="${escA(text)}">${escH(text)}</div>`).join('');
    return `<section class="note-highlights${compact ? ' compact' : ''} full"><div class="note-highlights-label">${escH(sectionLabel)}</div><div class="note-highlights-items">${itemsHTML}</div></section>`;
  }

  const limit = compact ? 3 : 5;
  const visible = items.slice(0, limit);
  const chips = visible.map(text => `<span class="note-highlight-chip" title="${escA(text)}">${escH(truncatePreviewText(text, compact ? 64 : 120))}</span>`).join('');
  const hidden = items.length - visible.length;
  const moreChip = hidden > 0 ? `<span class="note-highlight-chip note-highlight-chip-more">+${hidden}</span>` : '';
  return `<section class="note-highlights${compact ? ' compact' : ''}"><div class="note-highlights-label">${escH(sectionLabel)}</div><div class="note-highlights-items">${chips}${moreChip}</div></section>`;
}

// renderMarkdownToPlainText and stripCallSummaryHeader removed — notes are now pure HTML.
// Use htmlToPlainText(html) wherever plain text is needed.

function buildNoteCardTooltip(baseTooltip, highlights, { maxItems = 3, maxLen = 60 } = {}) {
  const items = [...(highlights || [])].map(normalizePreviewText).filter(Boolean);
  if (!items.length) return baseTooltip;
  const summary = items.slice(0, maxItems).map(text => truncatePreviewText(text, maxLen)).join(' • ');
  return `${baseTooltip}\n${typeof t === 'function' ? t('board.highlights') : 'Highlights'}: ${summary}`;
}

/** Surgically update a note's HTML, preserving all structure outside of the edited parts. */
/** Surgically update a note's HTML, preserving all structure outside of the edited parts. */
function applyNoteEdits(originalHTML, changes) {
  if (!originalHTML || typeof originalHTML !== 'string') {
    return buildNewNoteHTML({
      path: changes.path || 'notes/untitled.html',
      title: changes.title || '',
      date: changes.date || '',
      group_tags: changes.group_tags || [],
      major_topic_tags: changes.major_topic_tags || [],
      topic_tags: changes.topic_tags || [],
      extra_tags: changes.extra_tags || [],
      mainHTML: changes.mainHTML || '',
      summary: changes.summary || '',
      reviewed: changes.reviewed || false,
    });
  }

  const doc = new DOMParser().parseFromString(originalHTML, 'text/html');

  if (doc.querySelector('title')) {
    doc.querySelector('title').textContent = changes.title || '';
  }

  const setMeta = (name, arr) => {
    let el = doc.querySelector(`meta[name="${name}"]`);
    if (!el) {
      el = doc.createElement('meta');
      el.setAttribute('name', name);
      doc.head.appendChild(el);
    }
    el.setAttribute('content', encodeTagListToStorage(arr));
  };

  setMeta('group-tags', changes.group_tags || []);
  setMeta('major-topic-tags', changes.major_topic_tags || []);
  setMeta('topic-tags', changes.topic_tags || []);
  setMeta('extra-tags', changes.extra_tags || []);

  if (Object.prototype.hasOwnProperty.call(changes, 'workstream') || Object.prototype.hasOwnProperty.call(changes, 'workstreams')) {
    let wsVal = changes.workstream;
    if (wsVal === undefined && Array.isArray(changes.workstreams)) {
      wsVal = changes.workstreams.join(', ');
    }
    let wsMeta = doc.querySelector('meta[name="workstream"]');
    if (wsVal) {
      if (!wsMeta) {
        wsMeta = doc.createElement('meta');
        wsMeta.setAttribute('name', 'workstream');
        doc.head.appendChild(wsMeta);
      }
      wsMeta.setAttribute('content', wsVal);
    } else if (wsMeta) {
      wsMeta.remove();
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'reviewed')) {
    let el = doc.querySelector('meta[name="reviewed"]');
    if (changes.reviewed) {
      if (!el) { el = doc.createElement('meta'); el.setAttribute('name', 'reviewed'); doc.head.appendChild(el); }
      el.setAttribute('content', 'true');
    } else if (el) {
      el.remove();
    }
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'summary')) {
    let summarySection = doc.querySelector('section#note-summary');
    if (!summarySection) {
      summarySection = doc.createElement('section');
      summarySection.id = 'note-summary';
      summarySection.setAttribute('aria-label', (typeof t === 'function' ? t('editor.summary') : null) || 'Summary');
      doc.body.appendChild(summarySection);
    }
    summarySection.innerHTML = changes.summary || '';
    doc.querySelector('meta[name="summary"]')?.remove();
  }

  const headerH1 = doc.querySelector('header h1') || doc.querySelector('h1');
  if (headerH1) headerH1.textContent = changes.title || '';

  const dateEl = doc.querySelector('header .date, header .meta .date, .meta .date');
  if (dateEl) dateEl.textContent = changes.date || '';

  const metaDiv = doc.querySelector('header .meta, .meta');
  if (metaDiv) {
    metaDiv.querySelectorAll('.tag').forEach(el => el.remove());
    const groupTags = changes.group_tags || [];
    const majorTags = changes.major_topic_tags || [];
    const topicTags = changes.topic_tags || [];
    const extraTags = changes.extra_tags || [];
    const newTags = [
      ...groupTags.map(t => `<span class="tag group-tag">${escH(t)}</span>`),
      ...majorTags.map(t => `<span class="tag major-tag">${escH(t)}</span>`),
      ...topicTags.map(t => `<span class="tag topic-tag">${escH(t)}</span>`),
      ...extraTags.map(t => {
        const todoCls = getTodoClassForTag(t);
        const cls = `extra-tag${todoCls ? ' ' + escA(todoCls) : ''}`; // Guard class string
        return `<span class="tag ${cls}">${escH(t)}</span>`;
      }),
    ].join('');
    metaDiv.insertAdjacentHTML('beforeend', newTags);
  }

  const main = doc.querySelector('main');
  if (main && Object.prototype.hasOwnProperty.call(changes, 'mainHTML')) {
    main.innerHTML = changes.mainHTML || '';
  }

  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}

/** Build a brand-new note HTML file from scratch. */
function buildNewNoteHTML(note) {
  const pathParts = (note.path || '').split('/');
  const depth = Math.max(0, pathParts.length - 1);   // dirs between root and file
  const back = '../'.repeat(depth);

  const groupTags = note.group_tags || [];
  const majorTags = note.major_topic_tags || [];
  const topicTags = note.topic_tags || [];
  const extraTags = note.extra_tags || [];

  const tagSpans = [
    ...groupTags.map(t => `<span class="tag group-tag">${escH(t)}</span>`),
    ...majorTags.map(t => `<span class="tag major-tag">${escH(t)}</span>`),
    ...topicTags.map(t => `<span class="tag topic-tag">${escH(t)}</span>`),
    ...extraTags.map(t => {
      const todoCls = getTodoClassForTag(t);
      const cls = `extra-tag${todoCls ? ' ' + todoCls : ''}`;
      return `<span class="tag ${cls}">${escH(t)}</span>`;
    }),
  ].join('');

  const breadcrumb = [...groupTags, ...topicTags, note.title].filter(Boolean).join(' › ');

  const noteId = note.id || ('note-' + Date.now());
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8">
<meta name="note-id" content="${escA(noteId)}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="${back}icon.svg">
<meta name="group-tags" content="${escA(encodeTagListToStorage(groupTags))}">
<meta name="major-topic-tags" content="${escA(encodeTagListToStorage(majorTags))}">
<meta name="topic-tags" content="${escA(encodeTagListToStorage(topicTags))}">
<meta name="extra-tags" content="${escA(encodeTagListToStorage(extraTags))}">
<!-- summary stored in <section id="note-summary"> below -->
${note.reviewed ? '<meta name="reviewed" content="true">' : ''}
<title>${escH(note.title || '')}</title>
<style>
body{font-family:Calibri,Segoe UI,sans-serif;max-width:900px;margin:0 auto;padding:1rem 1.5rem;color:#1a1a1a}
header{border-bottom:2px solid #e5e7eb;padding-bottom:.75rem;margin-bottom:1.5rem}
nav{font-size:.85rem;color:#6b7280;margin-bottom:.5rem}
nav a{color:#374151;text-decoration:none}nav a:hover{text-decoration:underline}
h1{font-size:1.5rem;font-weight:600;margin:.25rem 0 .5rem}
.meta{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;margin-top:.5rem}
.date{font-size:.8rem;color:#6b7280;margin-right:.25rem}
.tag{display:inline-block;padding:2px 9px;border-radius:12px;font-size:.75rem;font-weight:500}
.group-tag{background:#bfdbfe;color:#1d4ed8}.major-tag{background:#fde68a;color:#9a3412}
.topic-tag{background:#bbf7d0;color:#166534}.extra-tag{background:#e5e7eb;color:#111827}
mark,.note-highlight{background:#fef3c7;color:#92400e;padding:0 .16em;border-radius:.2em;-webkit-box-decoration-break:clone;box-decoration-break:clone}

.tag.todo-high{background:#fee2e2;color:#b91c1c}
.tag.todo-med{background:#fffbeb;color:#92400e}
.tag.todo-wip{background:#eff6ff;color:#1d4ed8}
.tag.todo-low{background:#ecfdf5;color:#065f46}

.tag.todo-high::before,.tag.todo-med::before,.tag.todo-wip::before,.tag.todo-low::before{content:'';display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
.tag.todo-high::before{background:#ef4444}
.tag.todo-med::before{background:#f59e0b}
.tag.todo-wip::before{background:#3b82f6}
.tag.todo-low::before{background:#10b981}

/* Inline todo markers inside note content */
.note-todo{display:inline-block;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.02);border:1px dashed rgba(0,0,0,0.04);position:relative;cursor:pointer}
.note-todo::before{content:'';display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
.note-todo[data-todo-quadrant='Q1']::before,.note-todo[data-todo-priority='High']::before{background:#ef4444}
.note-todo[data-todo-quadrant='Q2']::before,.note-todo[data-todo-priority='Medium']::before{background:#3b82f6}
.note-todo[data-todo-quadrant='Q3']::before,.note-todo[data-todo-priority='Low']::before{background:#f59e0b}
.note-todo[data-todo-quadrant='Q4']::before{background:#6b7280}
.note-todo[data-todo-priority='WIP']::before,.note-todo[data-todo-status='WIP']::before{background:#7c3aed}
.note-todo.note-todo-done{opacity:0.6;text-decoration:line-through;border-style:solid;border-color:rgba(0,0,0,0.06)}
.note-todo.note-todo-wip{background:#eff6ff;border-color:#bfdbfe}

/* Compact todo action bar above note body */
.note-todo-bar{display:flex;flex-wrap:wrap;gap:5px;align-items:center;padding:5px 8px;background:#f8f9fb;border:1px solid #e5e7eb;border-radius:6px;margin:4px 0 6px;font-size:.78rem}
.note-todo-bar-label{font-weight:700;color:#6b7280;margin-right:2px;white-space:nowrap}
.note-todo-bar-item{display:inline-flex;align-items:center;gap:3px;background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:2px 5px}
.note-todo-badge{display:inline-block;padding:1px 5px;border-radius:3px;font-size:.68rem;font-weight:700;letter-spacing:.02em}
.note-todo-badge.q-q1,.note-todo-badge.p-high{background:#fee2e2;color:#b91c1c}
.note-todo-badge.q-q2,.note-todo-badge.p-medium{background:#eff6ff;color:#1d4ed8}
.note-todo-badge.q-q3,.note-todo-badge.p-low{background:#fffbeb;color:#92400e}
.note-todo-badge.q-q4{background:#f3f4f6;color:#374151}
.note-todo-badge.p-wip{background:#f3e8ff;color:#6b21a8}
.note-todo-badge.p-done{background:#f3f4f6;color:#6b7280;text-decoration:line-through}
.note-todo-action-btn{font-size:.7rem;padding:1px 6px;border:1px solid #d1d5db;border-radius:3px;background:#f9fafb;cursor:pointer;font-family:inherit}
.note-todo-action-btn:hover{background:#eff6ff;border-color:#93c5fd}

main{line-height:1.6}p{margin:.35rem 0}ul{margin:.25rem 0 .25rem 1.2rem;padding:0}li{margin:.15rem 0}
</style>
</head>
<body>
<header>
  <nav><a href="${back}app.html" id="back-link">← Index</a> &nbsp;|&nbsp; ${escH(breadcrumb)}</nav>
  <h1>${escH(note.title)}</h1>
  <div class="meta"><span class="date">${escH(note.date)}</span>${tagSpans}</div>
</header>
<main>
${note.mainHTML || '<p></p>'}
</main>
${note.summary ? `<section id="note-summary" aria-label="Summary">${note.summary}</section>` : ''}
</body>
</html>`;
}

// ═══ Rebuild index files ═══

/** Rebuild index files (no-op since index.html was removed). */
// ═══ Rebuild / Init ═══
async function rebuildIndexHTML() {
  // no-op (index.html is removed)
}

async function rebuildTodosBoardHTML() {
  function cards(items) {
    if (!items.length) return '<p style="color:#bbb;font-size:9pt;margin-top:8px">Empty.</p>';
    return items.slice().sort((a, b) => Number(isTodoWip(b)) - Number(isTodoWip(a))).map(t => {
      const display = t.title || t.id;
      const isWip = isTodoWip(t);
      return `    <div class="task${isWip ? ' task-wip' : ''}">${escH(display)}${isWip ? '<span class="task-badge task-badge-wip">WIP</span>' : ''}</div>`;
    }).join('\n');
  }
  const h = getTodosByPriority('High').length, m = getTodosByPriority('Medium').length, w = todosManifest.filter(t => isTodoWip(t) && t.priority !== 'Done').length, l = getTodosByPriority('Low').length, d = getTodosByPriority('Done').length;
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><title>Todo Board</title>
<style>
  body{font-family:Calibri,sans-serif;font-size:11pt;max-width:1100px;margin:40px auto;padding:0 24px;color:#222}
  h1{font-family:'Calibri Light',Calibri,sans-serif;font-size:20pt;color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:6px}
  .meta{color:#767676;font-size:9pt;margin-top:2px;margin-bottom:24px}
  nav{background:#f0f4f8;padding:10px 16px;border-radius:6px;margin-bottom:24px;font-size:10pt}
  nav a{color:#1a3a5c;text-decoration:none;margin-right:12px}
  .board{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
  .col{border-radius:8px;padding:14px 16px;min-height:200px}
  .col-high{background:#fff5f5;border:1px solid #f5c6c6}
  .col-medium{background:#fffbea;border:1px solid #f5e6a0}
  .col-low{background:#f0fff4;border:1px solid #b2dfcc}
  .col-done{background:#f5f5f5;border:1px solid #ddd}
  .col h2{font-size:12pt;margin:0 0 12px 0;padding-bottom:6px;border-bottom:2px solid}
  .col-high h2{color:#c0392b;border-color:#c0392b}.col-medium h2{color:#b7860b;border-color:#d4a017}
  .col-low h2{color:#1e7e44;border-color:#27ae60}.col-done h2{color:#888;border-color:#ccc}
  .task{background:#fff;border-radius:5px;padding:7px 10px;margin-bottom:8px;font-size:10pt;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .task-wip{background:#eff6ff;border-left:3px solid #3b82f6}
  .task-badge{display:inline-block;margin-left:6px;padding:1px 5px;border-radius:3px;font-size:8pt;font-weight:700}
  .task-badge-wip{background:#dbeafe;color:#1d4ed8}
  .task a{color:#1a3a5c;text-decoration:none}.task a:hover{text-decoration:underline}
  .col-done .task{opacity:.6}.count{font-size:9pt;color:#999;font-weight:normal;margin-left:4px}
</style>
</head><body>
<nav><a href="../app.html" id="back-link">⬆ Index</a></nav>
<h1>📋 Todo Board</h1>
<p class="meta">🔴 ${h} high &nbsp;·&nbsp; 🟡 ${m} medium &nbsp;·&nbsp; 🔵 ${w} in progress &nbsp;·&nbsp; 🟢 ${l} low &nbsp;·&nbsp; ✅ ${d} done</p>
<div class="board">
  <div class="col col-high">
    <h2>🔴 High <span class="count">(${h})</span></h2>
${cards(getTodosByPriority('High'))}
  </div>
  <div class="col col-medium">
    <h2>🟡 Medium <span class="count">(${m})</span></h2>
${cards(getTodosByPriority('Medium'))}
  </div>
  <div class="col col-low">
    <h2>🟢 Low <span class="count">(${l})</span></h2>
${cards(getTodosByPriority('Low'))}
  </div>
  <div class="col col-done">
    <h2>✅ Done <span class="count">(${d})</span></h2>
${cards(getTodosByPriority('Done'))}
  </div>
</div>
</body></html>`;
  await StorageAPI.writeTodosIndex(html);
}

async function rebuildAll() {
  try {
    // 1. Find all .html files under notes/
    const htmlFiles = await StorageAPI.listNoteFiles();

    // 2. Remove manifest entries for missing files
    const before = manifest.length;
    manifest = manifest.filter(m => htmlFiles.includes(m.path));
    const removed = before - manifest.length;

    // 3. Add manifest entries for orphan files
    let added = 0;
    for (const path of htmlFiles) {
      if (!manifest.some(m => m.path === path)) {
        try {
          const html = await StorageAPI.readNoteContent(path);
          if (!html.trim()) continue; // Ignore completely empty files
          const meta = parseNoteHTML(html);
          if (!meta.mainHTML.trim()) continue; // Ignore files with no <main> content (nav/index files)
          manifest.push({
            id: meta.id || '',
            title: meta.title || path.split('/').pop().replace(/\.html$/, ''),
            path,
            group_tags: meta.group_tags || [],
            major_topic_tags: meta.major_topic_tags || [],
            topic_tags: meta.topic_tags || [],
            extra_tags: meta.extra_tags || [],
            date: '',
            modified: new Date().toISOString(),
          });
          added++;
        } catch (e) {
          console.warn('Failed to parse orphan note', path, e);
        }
      }
    }

    await saveManifest({ force: true });
    await rebuildIndexHTML();
    // 4. Refresh the UI to reflect manifest changes
    renderFilterChips();
    renderBoard();

    const parts = ['✅ Rebuilt'];
    if (added) parts.push(`+${added} orphan${added > 1 ? 's' : ''}`);
    if (removed) parts.push(`−${removed} missing`);
    toast(parts.join(' · '));
  } catch (e) { toast(t('common.rebuildError', { message: e.message }), true); }
}
// LEGACY — replaced by loadTodosManifest / saveTodosManifest
async function loadTodosOrder() { return { High: [], Medium: [], Low: [], Done: [] }; }
async function saveTodosOrder() { /* LEGACY */ }
async function loadAllTodos() { /* LEGACY */ }
async function moveTodoFile(filename, fromPriority, toPriority, skipConfirm = false, insertIndex = null) { /* LEGACY */ }
async function renameTodoFile(oldFilename, priority, newTitle) { /* LEGACY */ }

// Clear all done todos
async function clearDone() {
  const deletedIds = todosManifest.filter(t => t.priority === 'Done').map(t => t.id);
  todosManifest = todosManifest.filter(t => t.priority !== 'Done');
  await saveTodosManifest({ deletedIds });
  if (typeof refreshTodoViews === 'function') refreshTodoViews();
  toast(t('common.clearedDoneTasks'));
}

async function loadTodosManifest(options = {}) {
  const nonDoneOnly = !!options.nonDoneOnly;
  todosLoadState = 'loading';
  try {
    const allTodos = await _readTodosManifestFromDisk();
    todosManifest = nonDoneOnly
      ? allTodos.filter(todo => todo.priority !== 'Done')
      : allTodos;
    todosLoadState = nonDoneOnly ? 'partial' : 'ready';
  } catch (e) {
    todosManifest = [];
    todosLoadState = 'error';
  }
}

async function migrateToManifest() {
  // Step 1: Stamp note IDs on all existing notes missing one
  for (const entry of manifest) {
    if (entry.id) continue;
    try {
      let html = await StorageAPI.readNoteContent(entry.path);
      const doc = new DOMParser().parseFromString(html, 'text/html');
      if (doc.querySelector('meta[name="note-id"]')) {
        const existingId = doc.querySelector('meta[name="note-id"]').getAttribute('content');
        entry.id = existingId;
        continue;
      }
      const noteId = 'note-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      const metaEl = doc.createElement('meta');
      metaEl.setAttribute('name', 'note-id');
      metaEl.setAttribute('content', noteId);
      doc.head.insertBefore(metaEl, doc.head.firstChild);
      await StorageAPI.writeNoteContent(entry.path, '<!DOCTYPE html>\n' + doc.documentElement.outerHTML);
      entry.id = noteId;
    } catch (e) { console.warn('Could not stamp note-id on', entry.path, e); }
  }
  await saveManifest({ force: true });

  // Step 2: Build todos/manifest.json from .md files
  const todosArr = [];
  for (const p of ['High', 'Medium', 'Low', 'Done']) {
    const files = await StorageAPI.listLegacyTodoMdFiles(p);
    for (const filename of files) {
      try {
        const content = await StorageAPI.readNoteContent(`todos/${p}/${filename}`);
        const lines = content.split('\n');
        const sourceLine = (lines.find(l => l.startsWith('Source:')) || '').replace(/^Source:\s*/, '').trim();
        const noteTodoIdLine = (lines.find(l => l.startsWith('NoteTodoID:')) || '').replace(/^NoteTodoID:\s*/, '').trim();
        const ownerLine = (lines.find(l => l.startsWith('Owner:')) || '').replace(/^Owner:\s*/, '').trim();
        const blankIdx = lines.findIndex(l => l.trim() === '');
        const context = (blankIdx >= 0 ? lines.slice(blankIdx + 1) : []).join('\n').trim();
        const title = filename.replace(/\.md$/, '').replace(/[-_]/g, ' ');
        const noteEntry = sourceLine ? manifest.find(n => n.path === sourceLine) : null;
        const todoId = noteTodoIdLine || ('todo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
        todosArr.push({
          id: todoId,
          title,
          priority: p,
          ownerId: (typeof resolveColleagueId === 'function') ? (resolveColleagueId(ownerLine || 'me', { allowCreate: false, allowMe: true }) || 'me') : (ownerLine || 'me'),
          owner: ownerLine,
          noteId: noteEntry ? (noteEntry.id || '') : '',
          noteTodoMarkerId: noteTodoIdLine || todoId,
          context,
          created: new Date().toISOString().slice(0, 10),
          modified: new Date().toISOString().slice(0, 10),
        });
      } catch (e) { console.warn('Migration: could not parse', filename, e); }
    }
  }
  todosManifest = todosArr;
  await saveTodosManifest();

  // Step 3: Delete old .md files
  for (const p of ['High', 'Medium', 'Low', 'Done']) {
    const files = await StorageAPI.listLegacyTodoMdFiles(p);
    for (const f of files) {
      try { await StorageAPI.deleteLegacyTodoFile(p, f); } catch (e) { console.warn('Migration: could not delete', f, e); }
    }
  }
  try { await StorageAPI.deleteLegacyTodoOrderFile(); } catch (e) { /* might not exist */ }

  // Step 4: Strip data-todo-file from all note HTML spans
  for (const entry of manifest) {
    try {
      let html = await StorageAPI.readNoteContent(entry.path);
      if (!html.includes('data-todo-file')) continue;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('[data-todo-file]').forEach(el => el.removeAttribute('data-todo-file'));
      await StorageAPI.writeNoteContent(entry.path, '<!DOCTYPE html>\n' + doc.documentElement.outerHTML);
      if (currentNote && currentNote.path === entry.path) {
        currentNote.originalHTML = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
        currentNote.mainHTML = doc.querySelector('main')?.innerHTML || currentNote.mainHTML;
      }
    } catch (e) { console.warn('Migration: could not strip data-todo-file from', entry.path, e); }
  }

  toast(t('common.migratedTodos'));
}

window.handleTodoScheduling = async function (todoId, todoTitle, scheduleOption) {
  if (scheduleOption === 'next-slot') {
    const defDur = 30;
    const slot = (typeof findNextAvailablePlannerSlot === 'function') ? findNextAvailablePlannerSlot(defDur) : null;
    if (slot) {
      const newEvent = {
        id: 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'todo',
        title: todoTitle,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        todoId: todoId,
        prepForEventId: '',
        noteId: '',
        linkedNoteIds: [],
        linkedTodoIds: []
      };
      if (typeof plannerEvents !== 'undefined') {
        plannerEvents.push(newEvent);
        if (typeof savePlanner === 'function') {
          await savePlanner();
        }
      }
    }
  } else if (scheduleOption === 'open-modal') {
    setTimeout(() => {
      if (typeof openPlanEventModal === 'function') {
        openPlanEventModal({
          type: 'todo',
          title: todoTitle,
          todoId: todoId
        });
      }
    }, 100);
  }
}

async function createNewTodo() {
  const scheduleOption = document.getElementById('nt-schedule')?.value || 'none';
  const titleInput = document.getElementById('nt-title');
  const textInput = document.getElementById('nt-text');
  const text = textInput ? textInput.value.trim() : '';
  const priority = document.getElementById('nt-priority')?.value || 'Medium';
  const ownerIdFromPicker = (typeof readCollaboratorPicker === 'function')
    ? readCollaboratorPicker('nt-owner-picker')
    : 'me';
  const ownerId = String(ownerIdFromPicker || '').trim() || 'me';
  const owner = (typeof getColleagueLabelById === 'function')
    ? getColleagueLabelById(ownerId, ownerId)
    : ownerId;
  const askedByIdFromPicker = (typeof readCollaboratorPicker === 'function')
    ? readCollaboratorPicker('nt-asked-by-picker')
    : '';
  const askedById = String(askedByIdFromPicker || '').trim();
  const dueDate = document.getElementById('nt-due-date')?.value || '';
  const context = document.getElementById('nt-context')?.value?.trim() || '';
  const titleFromInput = titleInput ? titleInput.value.trim() : '';
  const titleForCreation = titleFromInput || text;
  if (!titleForCreation) { toast(t('common.taskTextRequired'), true); if (textInput) textInput.focus(); return; }

  if (editingTodo) {
    // Editing existing todo
    const todoId = editingTodo.id;
    const todo = getTodoById(todoId);
    if (!todo) { toast(t('common.todoNotFound'), true); return; }
    try {
      const newTitle = titleInput ? titleInput.value.trim() : todo.title;
      const newPriority = priority;
      const newContext = context || text;
      const newOwnerId = ownerId;
      const newOwner = owner;
      const newAskedById = askedById;
      const newDueDate = dueDate;
      todo.title = newTitle || todo.title;
      todo.ownerId = newOwnerId;
      todo.owner = newOwner;
      todo.askedById = newAskedById;
      todo.dueDate = newDueDate;
      todo.context = newContext;
      todo.modified = new Date().toISOString().slice(0, 10);
      if (newPriority !== todo.priority) {
        changeTodoPriority(todoId, newPriority);
      }
      // Update linked note span if applicable
      const linkedNote = todo.noteId ? getNoteById(todo.noteId) : null;
      if (linkedNote) {
        try {
          let html = await StorageAPI.readNoteContent(linkedNote.path);
          html = updateNoteTodoMarkerInHTML(html, todo.noteTodoMarkerId || todoId, newTitle, newPriority);
          await StorageAPI.writeNoteContent(linkedNote.path, html);
          if (currentNote && currentNote.path === linkedNote.path) {
            currentNote.originalHTML = html;
            currentNote.mainHTML = new DOMParser().parseFromString(html, 'text/html').querySelector('main')?.innerHTML || currentNote.mainHTML;
            syncPreview();
          }
        } catch (e) { console.warn('Could not update note span', e); }
      }
      await saveTodosManifest();
      editingTodo = null;
      if (typeof refreshTodoViews === 'function') refreshTodoViews();
      closeModal('modal-new-todo');
      ['nt-title', 'nt-text', 'nt-context', 'nt-due-date'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      toast(t('common.todoSaved'));
      await handleTodoScheduling(todoId, newTitle || todo.title, scheduleOption);
    } catch (e) { toast(t('common.saveFailed', { message: e.message }), true); }
    return;
  }

  // Creating new todo
  const date = new Date().toISOString().slice(0, 10);
  const todoId = 'todo-' + Date.now();
  const todo = {
    id: todoId,
    title: titleForCreation.slice(0, 120),
    priority,
    ownerId,
    owner,
    askedById,
    dueDate,
    noteId: '',
    noteTodoMarkerId: todoId,
    context: context || text,
    created: date,
    modified: date,
  };
  try {
    todosManifest.push(todo);
    await saveTodosManifest();
    if (typeof refreshTodoViews === 'function') refreshTodoViews();
    closeModal('modal-new-todo');
    ['nt-title', 'nt-text', 'nt-context', 'nt-due-date'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    toast(t('common.todoAddedToPriority', { priority }));
    await handleTodoScheduling(todoId, todo.title, scheduleOption);

    if (window.AIChatController && AIChatController.activeSuggestionRoute) {
      const { msgIdx, actIdx } = AIChatController.activeSuggestionRoute;
      const msg = AIChatController.messages[msgIdx];
      if (msg && msg.parsed && Array.isArray(msg.parsed.suggested_actions)) {
        const action = msg.parsed.suggested_actions[actIdx];
        if (action) {
          action.accepted = true;
          action.createdId = todoId;
          AIChatController.saveCurrentConversation();
          AIChatController.renderMessages();
        }
      }
      AIChatController.activeSuggestionRoute = null;
    }
  } catch (e) { toast(t('common.createTodoFailed', { message: e.message }), true); }
}
function generateTodoId() {
  return 'ntodo-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
window.generateTodoId = generateTodoId;

async function migrateFavicons() {
  if (!rootHandle) return;

  // Check migration flags
  const folderName = rootHandle.name;
  if (settings.faviconMigrated || localStorage.getItem('secretaryFaviconMigrated_' + folderName) === '1') {
    return;
  }

  let updatedCount = 0;
  const total = manifest.length;
  for (let i = 0; i < total; i++) {
    const entry = manifest[i];
    if (!entry || !entry.path) continue;

    // Update progress text on loading screen
    if (i % 5 === 0 || i === total - 1) {
      if (typeof setLandingBusy === 'function') {
        setLandingBusy(true, t('common.migratingFaviconsProgress', { current: i + 1, total }));
      }
    }

    try {
      const html = await StorageAPI.readNoteContent(entry.path);
      if (!html) continue;

      // Check if favicon already present
      if (html.toLowerCase().includes('rel="icon"') || html.toLowerCase().includes("rel='icon'")) {
        continue;
      }

      // Calculate back path depth
      const pathParts = entry.path.split('/');
      const depth = pathParts.length - 1;
      const back = '../'.repeat(depth);

      // Parse and manipulate via DOMParser
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let head = doc.querySelector('head');
      if (!head) {
        head = doc.createElement('head');
        doc.documentElement.insertBefore(head, doc.body || doc.documentElement.firstChild);
      }

      const link = doc.createElement('link');
      link.rel = 'icon';
      link.type = 'image/svg+xml';
      link.href = `${back}icon.svg`;
      head.appendChild(link);

      const nextHtml = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;

      await StorageAPI.writeNoteContent(entry.path, nextHtml);
      updatedCount++;
    } catch (err) {
      console.warn(`Favicon migration failed for note ${entry.path}:`, err);
    }
  }

  // Save flags so it runs only once
  settings.faviconMigrated = true;
  localStorage.setItem('secretaryFaviconMigrated_' + folderName, '1');

  if (rootHandle) {
    try {
      await StorageAPI.writeSettings(settings);
    } catch (e) {
      console.warn('Could not write secretary-settings.json', e);
    }
  }
  saveLocalSettings();

  if (updatedCount > 0) {
    toast(t('common.migratedFavicons', { count: updatedCount }));
  }
}

// ═══ Wikilinks & Knowledge Graph Index ═══
async function rebuildNoteGraphIndex(options = {}) {
  if (typeof manifest === 'undefined' || !Array.isArray(manifest)) return;

  const forwardLinks = new Map(); // path -> Set<path>
  const backlinks = new Map();    // path -> Set<path>
  const titleToPathMap = new Map();

  manifest.forEach(note => {
    if (note && note.path && note.title) {
      titleToPathMap.set(note.title.toLowerCase().trim(), note.path);
    }
  });

  for (const note of manifest) {
    if (!note || !note.path) continue;
    const path = note.path;
    let content = (htmlLRUCache.get(path)?.text) || (noteContentCache[path]?.text) || (note.mainHTML || '');
    if (!content && typeof StorageAPI !== 'undefined' && StorageAPI.getNoteFromCache) {
      content = StorageAPI.getNoteFromCache(path) || '';
    }
    if (!content && typeof currentNote !== 'undefined' && currentNote && currentNote.path === path) {
      content = currentNote.mainHTML || currentNote.originalHTML || '';
    }
    if (!content && options?.fetchDisk && typeof StorageAPI !== 'undefined' && StorageAPI.readNoteContent) {
      try {
        const raw = await StorageAPI.readNoteContent(path);
        content = typeof raw === 'string' ? raw : (raw?.text || '');
        if (content) noteContentCache[path] = { modified: note.modified || '', text: content };
      } catch(e) {}
    }

    const outgoing = new Set();
    // Exclude code and pre blocks from wikilink parsing
    const cleanContent = String(content || '').replace(/<pre[\s\S]*?<\/pre>/gi, '').replace(/<code[\s\S]*?<\/code>/gi, '');
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = wikiLinkRegex.exec(cleanContent)) !== null) {
      const targetTitle = m[1].trim().toLowerCase();
      const targetPath = titleToPathMap.get(targetTitle);
      if (targetPath && targetPath !== path) {
        outgoing.add(targetPath);
      }
    }
    forwardLinks.set(path, outgoing);
  }

  forwardLinks.forEach((targets, sourcePath) => {
    targets.forEach(targetPath => {
      if (!backlinks.has(targetPath)) {
        backlinks.set(targetPath, new Set());
      }
      backlinks.get(targetPath).add(sourcePath);
    });
  });

  noteGraphIndex = {
    forwardLinks,
    backlinks,
    titleToPathMap,
    isHydrated: true
  };

  if (typeof StateBus !== 'undefined') {
    StateBus.emit('notegraph:rebuilt', { noteGraphIndex });
  }
  return noteGraphIndex;
}
window.rebuildNoteGraphIndex = rebuildNoteGraphIndex;

async function getBacklinksForNote(note) {
  if (!note || !note.path) return [];
  if (!noteGraphIndex.isHydrated) {
    await rebuildNoteGraphIndex();
  }
  const sourcePaths = noteGraphIndex.backlinks.get(note.path);
  if (!sourcePaths || sourcePaths.size === 0) return [];
  return Array.from(sourcePaths)
    .map(p => manifest.find(n => n.path === p))
    .filter(Boolean);
}
window.getBacklinksForNote = getBacklinksForNote;

async function getUnlinkedMentionsForNote(note) {
  if (!note || !note.path || !note.title) return [];
  const title = (note.title || '').trim();
  if (title.length < 3) return [];

  const escapeReg = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Safe cross-browser matching without lookbehind assertion
  const titlePattern = new RegExp(`(^|[^[\w])(${escapeReg(title)})(?=[^\]\w]|$)`, 'gi');
  const unlinked = [];

  for (const otherNote of (manifest || [])) {
    if (!otherNote || otherNote.path === note.path) continue;
    let content = (htmlLRUCache.get(otherNote.path)?.text) || (noteContentCache[otherNote.path]?.text) || (otherNote.mainHTML || '');
    if (!content && typeof StorageAPI !== 'undefined' && StorageAPI.getNoteFromCache) {
      content = StorageAPI.getNoteFromCache(otherNote.path) || '';
    }
    if (!content) continue;

    // Strip existing wikilinks and code blocks before matching to avoid false positives
    const strippedContent = content
      .replace(/\[\[[^\]]+\]\]/g, ' ')
      .replace(/<pre[\s\S]*?<\/pre>/gi, ' ')
      .replace(/<code[\s\S]*?<\/code>/gi, ' ');

    const match = titlePattern.exec(strippedContent);
    titlePattern.lastIndex = 0;
    if (match) {
      const idx = match.index;
      const start = Math.max(0, idx - 40);
      const end = Math.min(strippedContent.length, idx + title.length + 40);
      const snippet = (start > 0 ? '…' : '') + strippedContent.substring(start, end).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() + (end < strippedContent.length ? '…' : '');
      unlinked.push({
        note: otherNote,
        snippet: snippet
      });
    }
  }

  return unlinked;
}
window.getUnlinkedMentionsForNote = getUnlinkedMentionsForNote;

// ═══ Note Templates Engine ═══
const NoteTemplateManager = {
  getTemplates(lang) {
    const l = lang || (typeof getWorkingLanguage === 'function' ? getWorkingLanguage() : (typeof getNoteLanguage === 'function' ? getNoteLanguage() : 'en'));
    return [
      {
        id: 'standard',
        name: t('templates.standardName', { lang: l }),
        description: t('templates.standardDesc', { lang: l }),
        icon: '📝',
        headers: [
          t('common.goal', { lang: l }),
          t('common.notes', { lang: l }),
          t('common.decisions', { lang: l }),
          t('common.actions', { lang: l })
        ]
      },
      {
        id: 'meeting_1on1',
        name: t('templates.meeting1on1Name', { lang: l }),
        description: t('templates.meeting1on1Desc', { lang: l }),
        icon: '👥',
        headers: [
          t('templates.1on1CheckIn', { lang: l }),
          t('templates.1on1Agenda', { lang: l }),
          t('templates.1on1Feedback', { lang: l }),
          t('templates.1on1Decisions', { lang: l }),
          t('templates.1on1Actions', { lang: l })
        ]
      },
      {
        id: 'project_kickoff',
        name: t('templates.projectKickoffName', { lang: l }),
        description: t('templates.projectKickoffDesc', { lang: l }),
        icon: '🚀',
        headers: [
          t('templates.kickoffObjectives', { lang: l }),
          t('templates.kickoffScope', { lang: l }),
          t('templates.kickoffRoles', { lang: l }),
          t('templates.kickoffMilestones', { lang: l }),
          t('templates.kickoffRisks', { lang: l }),
          t('templates.kickoffNextSteps', { lang: l })
        ]
      },
      {
        id: 'decision_rfc',
        name: t('templates.decisionRfcName', { lang: l }),
        description: t('templates.decisionRfcDesc', { lang: l }),
        icon: '⚖️',
        headers: [
          t('templates.rfcContext', { lang: l }),
          t('templates.rfcProblem', { lang: l }),
          t('templates.rfcOptions', { lang: l }),
          t('templates.rfcDecision', { lang: l }),
          t('templates.rfcConsequences', { lang: l })
        ]
      },
      {
        id: 'postmortem',
        name: t('templates.postmortemName', { lang: l }),
        description: t('templates.postmortemDesc', { lang: l }),
        icon: '🛠️',
        headers: [
          t('templates.postmortemSummary', { lang: l }),
          t('templates.postmortemImpact', { lang: l }),
          t('templates.postmortemTimeline', { lang: l }),
          t('templates.postmortemRootCause', { lang: l }),
          t('templates.postmortemCorrective', { lang: l })
        ]
      },
      {
        id: 'daily_standup',
        name: t('templates.dailyStandupName', { lang: l }),
        description: t('templates.dailyStandupDesc', { lang: l }),
        icon: '☀️',
        headers: [
          t('templates.standupYesterday', { lang: l }),
          t('templates.standupToday', { lang: l }),
          t('templates.standupBlockers', { lang: l }),
          t('templates.standupDecisions', { lang: l })
        ]
      }
    ];
  },

  getTemplateHTML(templateId, lang) {
    const l = lang || (typeof getWorkingLanguage === 'function' ? getWorkingLanguage() : (typeof getNoteLanguage === 'function' ? getNoteLanguage() : 'en'));
    switch (templateId) {
      case 'meeting_1on1':
        return `
<h2>${escH(t('templates.1on1CheckIn', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.1on1Agenda', { lang: l }))}</h2>
<ul>
  <li></li>
</ul>
<h2>${escH(t('templates.1on1Feedback', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.1on1Decisions', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.1on1Actions', { lang: l }))}</h2>
<ul>
  <li></li>
</ul>`;

      case 'project_kickoff':
        return `
<h2>${escH(t('templates.kickoffObjectives', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.kickoffScope', { lang: l }))}</h2>
<ul>
  <li></li>
</ul>
<h2>${escH(t('templates.kickoffRoles', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.kickoffMilestones', { lang: l }))}</h2>
<ul>
  <li></li>
</ul>
<h2>${escH(t('templates.kickoffRisks', { lang: l }))}</h2>
<ul>
  <li></li>
</ul>
<h2>${escH(t('templates.kickoffNextSteps', { lang: l }))}</h2>
<p></p>`;

      case 'decision_rfc':
        return `
<h2>${escH(t('templates.rfcContext', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.rfcProblem', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.rfcOptions', { lang: l }))}</h2>
<ul>
  <li><strong>Option A:</strong> </li>
  <li><strong>Option B:</strong> </li>
</ul>
<h2>${escH(t('templates.rfcDecision', { lang: l }))}</h2>
<p>!decision:active ""</p>
<h2>${escH(t('templates.rfcConsequences', { lang: l }))}</h2>
<ul>
  <li></li>
</ul>`;

      case 'postmortem':
        return `
<h2>${escH(t('templates.postmortemSummary', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.postmortemImpact', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.postmortemTimeline', { lang: l }))}</h2>
<ul>
  <li><strong>HH:MM:</strong> </li>
</ul>
<h2>${escH(t('templates.postmortemRootCause', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.postmortemCorrective', { lang: l }))}</h2>
<ul>
  <li></li>
</ul>`;

      case 'daily_standup':
        return `
<h2>${escH(t('templates.standupYesterday', { lang: l }))}</h2>
<ul>
  <li></li>
</ul>
<h2>${escH(t('templates.standupToday', { lang: l }))}</h2>
<ul>
  <li></li>
</ul>
<h2>${escH(t('templates.standupBlockers', { lang: l }))}</h2>
<p></p>
<h2>${escH(t('templates.standupDecisions', { lang: l }))}</h2>
<p></p>`;

      default:
        return typeof getDefaultNoteTemplateHTML === 'function'
          ? getDefaultNoteTemplateHTML(l)
          : `<h2>${escH(t('common.goal', { lang: l }))}</h2><p></p><h2>${escH(t('common.notes', { lang: l }))}</h2><p></p><h2>${escH(t('common.decisions', { lang: l }))}</h2><p></p><h2>${escH(t('common.actions', { lang: l }))}</h2><p></p>`;
    }
  }
};
window.NoteTemplateManager = NoteTemplateManager;

// ═══ Note Share & Export Formatter ═══
const NoteShareFormatter = {
  formatForSlack(title, html) {
    const raw = String(html || '');
    let text = `*${title || 'Note'}*\n\n`;
    
    let parsed = raw
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n*$1*\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n*$1*\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n_$1_\n')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '• $1\n')
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
      .replace(/<strong>([\s\S]*?)<\/strong>/gi, '*$1*')
      .replace(/<b>([\s\S]*?)<\/b>/gi, '*$1*')
      .replace(/<em>([\s\S]*?)<\/em>/gi, '_$1_')
      .replace(/<i>([\s\S]*?)<\/i>/gi, '_$1_')
      .replace(/!decision:(?:active|replaced|superseded)\s+"([^"]+)"/gi, '📜 *Decision:* $1')
      .replace(/#todo:([a-zA-Z0-9_-]+)/gi, '✅ *Task:*')
      .replace(/<[^>]+>/g, '');

    parsed = parsed
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text + parsed;
  },

  formatForEmail(title, html) {
    const cleanTitle = typeof escH === 'function' ? escH(title || 'Note') : (title || 'Note');
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${cleanTitle}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 680px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px;">${cleanTitle}</h1>
  <div style="font-size: 15px;">
    ${html || ''}
  </div>
</body>
</html>`;
  },

  formatForMarkdown(title, html) {
    let md = `# ${title || 'Note'}\n\n`;
    if (typeof turndownService !== 'undefined' && typeof turndownService.turndown === 'function') {
      md += turndownService.turndown(html || '');
    } else {
      md += String(html || '')
        .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
        .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
        .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
        .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
        .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
    }
    return md;
  }
};
window.NoteShareFormatter = NoteShareFormatter;

/**
 * Secretary - Standalone Note File Export Engine
 * Generates standalone markdown files and manages PDF printing.
 */
const NoteFileExportEngine = {
  getSanitizedFilename(title) {
    const raw = String(title || '').trim().toLowerCase();
    const clean = raw.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
    return (clean || 'note') + '.md';
  },

  generateMarkdownContent(note) {
    if (!note) return '';
    const title = note.title || 'Note';
    const html = note.mainHTML || note.body_html || note.content || '';
    return NoteShareFormatter.formatForMarkdown(title, html);
  },

  downloadMarkdown(note) {
    if (!note) return;
    const md = this.generateMarkdownContent(note);
    const filename = this.getSanitizedFilename(note.title);

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (typeof toast === 'function') {
      toast(t('share.downloadMdSuccess') || 'Markdown file downloaded!');
    }
  },

  printToPdf() {
    window.print();
  }
};
window.NoteFileExportEngine = NoteFileExportEngine;



