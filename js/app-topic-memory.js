// ── Secretary: Workstream & Topic Memory Engine ──
// Manages persistent, evolving Topic / Workstream Memory files with 30-day auto-archiving,
// 1-sentence summary cataloging, regex searching, and cross-note organizational context.

const TOPIC_MEMORY_ARCHIVE_DAYS = 30;
const TOPIC_MEMORY_INDEX_PATH = 'raw/topic-memories/index.json';
const TOPIC_MEMORY_INDEX_LS_KEY = 'secretary_topic_memories_index';

let _topicMemoriesIndexCache = null;

function sanitizeTopicMemoryKey(majorTopic) {
  if (!majorTopic || typeof majorTopic !== 'string') return '';
  const clean = majorTopic.trim();
  if (!clean) return '';
  const normalized = clean
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');
  return normalized
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Check if a topic timestamp is older than 30 days */
function isTopicMemoryStale(lastUpdatedIso) {
  if (!lastUpdatedIso) return false;
  const ts = parseFlexibleTimestamp(lastUpdatedIso);
  if (!ts || isNaN(ts)) return false;
  const diffDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return diffDays > TOPIC_MEMORY_ARCHIVE_DAYS;
}

/** Helper to robustly parse various date formats (ISO, DD/MM/YYYY, YYYY-MM-DD) without NaN */
function parseFlexibleTimestamp(dateStr) {
  if (!dateStr) return 0;
  if (typeof dateStr === 'number') return dateStr;
  const s = String(dateStr).trim();
  if (!s) return 0;
  
  // 1. Direct parse
  const direct = new Date(s).getTime();
  if (!isNaN(direct) && direct > 0) return direct;

  // 2. European format DD/MM/YYYY or DD-MM-YYYY
  const euMatch = s.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})/);
  if (euMatch) {
    const day = parseInt(euMatch[1], 10);
    const month = parseInt(euMatch[2], 10) - 1;
    const year = parseInt(euMatch[3], 10);
    const d = new Date(year, month, day).getTime();
    if (!isNaN(d)) return d;
  }
  return 0;
}

/** Initialize and load the Master Topic Memories Index */
async function loadTopicMemoriesIndex() {
  let indexData = { topics: [] };

  if (typeof StorageAPI !== 'undefined' && StorageAPI.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
    try {
      const remoteIndex = await window.FirebaseSyncService.getDoc('topic_memories', 'index');
      if (remoteIndex && Array.isArray(remoteIndex.topics)) {
        indexData = remoteIndex;
      }
    } catch (_e) {}
  } else {
    // 1. Try file system
    try {
      if (typeof readFile === 'function') {
        const content = await readFile(TOPIC_MEMORY_INDEX_PATH);
        if (content) {
          indexData = JSON.parse(content);
        }
      }
    } catch (_e) {}
  }

  // 2. Fallback / Sync with LocalStorage
  if (!indexData.topics || indexData.topics.length === 0) {
    try {
      const cached = localStorage.getItem(TOPIC_MEMORY_INDEX_LS_KEY) || localStorage.getItem('secretary_topic_memories_index_v1');
      if (cached) indexData = JSON.parse(cached);
    } catch (_e) {}
  }

  if (!Array.isArray(indexData.topics)) indexData.topics = [];

  // Apply 30-day auto-archiving policy
  let indexModified = false;
  indexData.topics.forEach(item => {
    if (!item) return;
    if (item.status !== 'archived' && !item.pinned && isTopicMemoryStale(item.lastUpdated)) {
      item.status = 'archived';
      indexModified = true;
    }
  });

  _topicMemoriesIndexCache = indexData;

  if (indexModified) {
    await persistTopicMemoriesIndex(indexData);
  }

  return indexData;
}

/** Persist the Master Topic Memories Index */
async function persistTopicMemoriesIndex(indexData) {
  if (!indexData || !Array.isArray(indexData.topics)) return;
  _topicMemoriesIndexCache = indexData;

  const jsonStr = JSON.stringify(indexData, null, 2);

  try {
    localStorage.setItem(TOPIC_MEMORY_INDEX_LS_KEY, jsonStr);
    localStorage.setItem('secretary_topic_memories_index_v1', jsonStr);
  } catch (_e) {}

  if (typeof StorageAPI !== 'undefined' && StorageAPI.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
    try {
      await window.FirebaseSyncService.putDoc('topic_memories', 'index', indexData);
    } catch (_e) {}
  } else {
    try {
      if (typeof writeFile === 'function') {
        await writeFile(TOPIC_MEMORY_INDEX_PATH, jsonStr);
      }
    } catch (_e) {}
  }
}

/** Get a compact catalog of all topic memories with 1-sentence summaries for LLM prompt injection & UI lists */
async function getTopicMemoriesCatalog(options = {}) {
  const includeArchived = options.includeArchived !== false;
  const index = await loadTopicMemoriesIndex();

  let list = index.topics || [];
  if (!includeArchived) {
    list = list.filter(t => t.status !== 'archived');
  }

  return list.map(t => ({
    key: t.key || sanitizeTopicMemoryKey(t.topicName),
    topicName: t.topicName || t.key || 'Untitled Topic',
    summary: t.summary || 'No summary recorded.',
    status: t.status || 'active',
    lastUpdated: t.lastUpdated || new Date().toISOString(),
    mappedTags: t.mappedTags || { major_topic_tags: [], group_tags: [], topic_tags: [] },
    factsCount: t.factsCount || 0,
    decisionsCount: t.decisionsCount || 0,
    associatedNotesCount: t.associatedNotesCount || 0,
    pinned: !!t.pinned
  }));
}

// In-memory memory dossier cache to eliminate disk I/O latency on repeated access
const _topicMemoryFileCache = new Map();

/** Preload all workstream memory files into _topicMemoryFileCache during app startup */
async function preloadAllWorkstreamMemories() {
  try {
    const catalog = await getTopicMemoriesCatalog({ includeArchived: true });
    if (Array.isArray(catalog) && catalog.length > 0) {
      for (const item of catalog) {
        const topicName = item.topicName || item.key;
        if (topicName) {
          await getMajorTopicMemory(topicName, { skipAutoArchive: true });
        }
      }
    }
  } catch (e) {
    console.warn('preloadAllWorkstreamMemories failed:', e);
  }
}
window.preloadAllWorkstreamMemories = preloadAllWorkstreamMemories;

/** Synchronously retrieve in-memory cached Topic Memory dossier if available */
function getMajorTopicMemorySync(majorTopic) {
  if (!majorTopic || typeof majorTopic !== 'string') return null;
  const sanitized = sanitizeTopicMemoryKey(majorTopic);
  if (!sanitized) return null;
  if (_topicMemoryFileCache.has(sanitized)) {
    return _topicMemoryFileCache.get(sanitized);
  }
  return null;
}
window.getMajorTopicMemorySync = getMajorTopicMemorySync;

/** Read full Topic Memory dossier by key or topic name */
async function getMajorTopicMemory(majorTopic, options = {}) {
  const sanitized = sanitizeTopicMemoryKey(majorTopic);
  if (!sanitized) return null;

  if (_topicMemoryFileCache.has(sanitized) && options.forceReload !== true) {
    return _topicMemoryFileCache.get(sanitized);
  }

  const filePath = `raw/topic-memories/${sanitized}.json`;
  let memoryPayload = null;

  if (typeof StorageAPI !== 'undefined' && StorageAPI.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
    try {
      const remoteMem = await window.FirebaseSyncService.getDoc('topic_memories', sanitized);
      if (remoteMem) {
        memoryPayload = remoteMem;
      }
    } catch (_e) {}
  } else {
    try {
      if (typeof readFile === 'function') {
        const content = await readFile(filePath);
        if (content) {
          memoryPayload = JSON.parse(content);
        }
      }
    } catch (_e) {}
  }

  if (!memoryPayload) {
    try {
      const cached = localStorage.getItem(`secretary_topic_memory_${sanitized}`);
      if (cached) memoryPayload = JSON.parse(cached);
    } catch (_e) {}
  }

  if (memoryPayload) {
    _topicMemoryFileCache.set(sanitized, memoryPayload);
  }

  if (memoryPayload && options.skipAutoArchive !== true) {
    // Check auto-archiving state
    if (memoryPayload.status !== 'archived' && !memoryPayload.pinned && isTopicMemoryStale(memoryPayload.lastUpdated)) {
      memoryPayload.status = 'archived';
      await saveMajorTopicMemory(memoryPayload.topicName || majorTopic, memoryPayload, { skipIndexRefresh: false });
    }
  }

  return memoryPayload;
}
window.getMajorTopicMemory = getMajorTopicMemory;

/** Save or update a Topic Memory file and refresh index */
async function saveMajorTopicMemory(majorTopic, data, options = {}) {
  if (!majorTopic || typeof majorTopic !== 'string' || !data) return null;
  const cleanTopicName = majorTopic.trim();
  const sanitized = sanitizeTopicMemoryKey(cleanTopicName);
  if (!cleanTopicName || !sanitized) return null;
  const filePath = `raw/topic-memories/${sanitized}.json`;

  const existing = await getMajorTopicMemory(cleanTopicName, { skipAutoArchive: true });

  const nowIso = new Date().toISOString();
  const rawSummary = typeof data.summary === 'string' ? data.summary : (existing?.summary || '');
  const cleanSummaryText = rawSummary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const oneSentenceSummary = typeof data.oneSentenceSummary === 'string' && data.oneSentenceSummary.trim()
    ? data.oneSentenceSummary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    : (cleanSummaryText ? cleanSummaryText.split(/(?<=[.!?])\s+/)[0].trim() : '');

  const tagGroups = Array.isArray(data.mappedTags?.tagGroups)
    ? data.mappedTags.tagGroups
    : (Array.isArray(existing?.mappedTags?.tagGroups) ? existing.mappedTags.tagGroups : []);

  const groupTagsFromRules = tagGroups.map(g => (g.group || '').trim()).filter(Boolean);
  const majorTagsFromRules = tagGroups.map(g => (g.major || '').trim()).filter(Boolean);
  const topicTagsFromRules = tagGroups.map(g => (g.topic || '').trim()).filter(Boolean);

  // Tag mapping: if data.mappedTags is explicitly provided, do not unconditionally force merge with existing
  const finalMajorTags = data.mappedTags?.major_topic_tags !== undefined
    ? Array.from(new Set([...(data.mappedTags.major_topic_tags || []), ...majorTagsFromRules, cleanTopicName]))
    : Array.from(new Set([...(existing?.mappedTags?.major_topic_tags || []), ...majorTagsFromRules, cleanTopicName]));

  const finalGroupTags = data.mappedTags?.group_tags !== undefined
    ? Array.from(new Set([...(data.mappedTags.group_tags || []), ...groupTagsFromRules]))
    : Array.from(new Set([...(existing?.mappedTags?.group_tags || []), ...groupTagsFromRules]));

  const finalTopicTags = data.mappedTags?.topic_tags !== undefined
    ? Array.from(new Set([...(data.mappedTags.topic_tags || []), ...topicTagsFromRules]))
    : Array.from(new Set([...(existing?.mappedTags?.topic_tags || []), ...topicTagsFromRules]));

  const payload = {
    key: sanitized,
    topicName: cleanTopicName,
    status: data.status || existing?.status || 'active',
    created: existing?.created || data.created || nowIso,
    lastUpdated: nowIso,
    lastNoteId: data.lastNoteId || data.noteId || existing?.lastNoteId || '',
    lastNoteTitle: data.lastNoteTitle || data.noteTitle || existing?.lastNoteTitle || '',
    summary: typeof data.summary === 'string' ? data.summary : (existing?.summary || ''),
    oneSentenceSummary: oneSentenceSummary,
    mappedTags: {
      major_topic_tags: finalMajorTags,
      group_tags: finalGroupTags,
      topic_tags: finalTopicTags,
      tagGroups: tagGroups
    },
    keyFacts: Array.isArray(data.keyFacts) ? data.keyFacts : (Array.isArray(data.key_facts) ? data.key_facts : (existing?.keyFacts || [])),
    activeMilestones: Array.isArray(data.activeMilestones) ? data.activeMilestones : (Array.isArray(data.milestones) ? data.milestones : (existing?.activeMilestones || [])),
    decisions: Array.isArray(data.decisions) ? data.decisions : (existing?.decisions || []),
    openThreads: Array.isArray(data.openThreads) ? data.openThreads : (Array.isArray(data.open_threads) ? data.open_threads : (existing?.openThreads || [])),
    participants: Array.isArray(data.participants) ? data.participants : (existing?.participants || []),
    associatedNotes: Array.isArray(data.associatedNotes) ? data.associatedNotes : (existing?.associatedNotes || []),
    scratchpad: typeof data.scratchpad === 'string' ? data.scratchpad : (existing?.scratchpad || ''),
    pinned: typeof data.pinned === 'boolean' ? data.pinned : (existing?.pinned || false),
    suggestedMeetings: Array.isArray(data.suggestedMeetings) ? data.suggestedMeetings : (Array.isArray(data.suggested_meetings) ? data.suggested_meetings : (existing?.suggestedMeetings || []))
  };

  // In-memory cache update
  _topicMemoryFileCache.set(sanitized, payload);

  // LocalStorage mirror
  try {
    localStorage.setItem(`secretary_topic_memory_${sanitized}`, JSON.stringify(payload));
  } catch (_e) {}

  // Storage engine write
  if (typeof StorageAPI !== 'undefined' && StorageAPI.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
    try {
      await window.FirebaseSyncService.putDoc('topic_memories', sanitized, payload);
    } catch (_e) {}
  } else {
    try {
      if (typeof writeFile === 'function') {
        await writeFile(filePath, JSON.stringify(payload, null, 2));
      }
    } catch (_e) {}
  }

  // Update Index
  if (options.skipIndexRefresh !== true) {
    const index = await loadTopicMemoriesIndex();
    const existingIdx = index.topics.findIndex(t => t.key === sanitized);

    const indexEntry = {
      key: sanitized,
      topicName: cleanTopicName,
      summary: oneSentenceSummary,
      status: payload.status,
      lastUpdated: payload.lastUpdated,
      mappedTags: payload.mappedTags,
      factsCount: payload.keyFacts.length,
      decisionsCount: payload.decisions.length,
      associatedNotesCount: payload.associatedNotes.length,
      pinned: payload.pinned
    };

    if (existingIdx >= 0) {
      index.topics[existingIdx] = indexEntry;
    } else {
      index.topics.push(indexEntry);
    }

    await persistTopicMemoriesIndex(index);
  }

  return payload;
}
window.saveMajorTopicMemory = saveMajorTopicMemory;

/** Search across all active and archived topic memory dossiers using Regex or text matching */
async function searchTopicMemories(queryStr) {
  if (!queryStr || typeof queryStr !== 'string' || !queryStr.trim()) return [];
  const index = await loadTopicMemoriesIndex();
  const results = [];

  const escaped = queryStr.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'gi');

  for (const topicMeta of index.topics || []) {
    const memory = await getMajorTopicMemory(topicMeta.key || topicMeta.topicName, { skipAutoArchive: true });
    if (!memory) continue;

    // Convert memory object into lines for context extraction
    const lines = [];
    lines.push(`Topic: ${memory.topicName} (Status: ${memory.status})`);
    lines.push(`Summary: ${memory.summary}`);
    if (Array.isArray(memory.keyFacts) && memory.keyFacts.length) {
      lines.push(`Key Facts: ${memory.keyFacts.map(f => typeof f === 'string' ? f : JSON.stringify(f)).join(' | ')}`);
    }
    if (Array.isArray(memory.activeMilestones) && memory.activeMilestones.length) {
      lines.push(`Milestones: ${memory.activeMilestones.map(m => typeof m === 'string' ? m : (m.text || m.title || JSON.stringify(m))).join(' | ')}`);
    }
    if (Array.isArray(memory.decisions) && memory.decisions.length) {
      lines.push(`Decisions: ${memory.decisions.map(d => typeof d === 'string' ? d : (d.text || d.title || d.decision || JSON.stringify(d))).join(' | ')}`);
    }
    if (Array.isArray(memory.openThreads) && memory.openThreads.length) {
      lines.push(`Open Threads: ${memory.openThreads.map(t => typeof t === 'string' ? t : JSON.stringify(t)).join(' | ')}`);
    }
    if (Array.isArray(memory.participants) && memory.participants.length) {
      lines.push(`Participants: ${memory.participants.map(p => typeof p === 'string' ? p : (p.name || JSON.stringify(p))).join(', ')}`);
    }

    const matchingSnippets = [];
    lines.forEach((line, idx) => {
      regex.lastIndex = 0;
      if (regex.test(line)) {
        const prevLine = idx > 0 ? lines[idx - 1] : null;
        const nextLine = idx < lines.length - 1 ? lines[idx + 1] : null;

        matchingSnippets.push({
          prev: prevLine,
          match: line,
          next: nextLine
        });
      }
    });

    if (matchingSnippets.length > 0) {
      results.push({
        memoryKey: memory.key,
        topicName: memory.topicName,
        status: memory.status,
        lastUpdated: memory.lastUpdated,
        summary: memory.summary,
        snippets: matchingSnippets
      });
    }
  }

  return results;
}

/** Archive a topic memory file manually */
async function archiveTopicMemory(majorTopic) {
  const memory = await getMajorTopicMemory(majorTopic);
  if (!memory) return null;
  memory.status = 'archived';
  return await saveMajorTopicMemory(majorTopic, memory);
}

/** Unarchive / Reactivate a topic memory file manually */
async function unarchiveTopicMemory(majorTopic) {
  const memory = await getMajorTopicMemory(majorTopic);
  if (!memory) return null;
  memory.status = 'active';
  memory.lastUpdated = new Date().toISOString();
  return await saveMajorTopicMemory(majorTopic, memory);
}

/** Delete a topic memory file and remove from index */
async function deleteTopicMemory(majorTopic) {
  const sanitized = sanitizeTopicMemoryKey(majorTopic);
  if (!sanitized) return false;

  _topicMemoryFileCache.delete(sanitized);
  _topicMemoryFileCache.delete(majorTopic);

  const index = await loadTopicMemoriesIndex();
  index.topics = index.topics.filter(t => t.key !== sanitized && t.topicName !== majorTopic);
  await persistTopicMemoriesIndex(index);

  try {
    localStorage.removeItem(`secretary_topic_memory_${sanitized}`);
    localStorage.removeItem(`secretary_topic_memory_${majorTopic}`);
  } catch (_e) {}

  try {
    if (typeof localStorage !== 'undefined') {
      const order = JSON.parse(localStorage.getItem('secretary_workstream_custom_order') || '[]');
      if (Array.isArray(order)) {
        const newOrder = order.filter(w => w !== majorTopic && w !== sanitized);
        localStorage.setItem('secretary_workstream_custom_order', JSON.stringify(newOrder));
        if (typeof workstreamCustomOrder !== 'undefined' && Array.isArray(workstreamCustomOrder)) {
          workstreamCustomOrder = newOrder;
        }
      }
      const favs = JSON.parse(localStorage.getItem('secretary_favorite_registry_projects') || '[]');
      if (Array.isArray(favs)) {
        const newFavs = favs.filter(w => w !== majorTopic && w !== sanitized);
        localStorage.setItem('secretary_favorite_registry_projects', JSON.stringify(newFavs));
        if (typeof favoriteRegistryProjects !== 'undefined' && favoriteRegistryProjects instanceof Set) {
          favoriteRegistryProjects.delete(majorTopic);
          favoriteRegistryProjects.delete(sanitized);
        }
      }
    }
  } catch (_e) {}

  if (typeof StorageAPI !== 'undefined' && StorageAPI.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
    try {
      await window.FirebaseSyncService.deleteDoc('topic_memories', sanitized);
    } catch (_e) {}
  } else {
    try {
      if (typeof deleteFile === 'function') {
        await deleteFile(`raw/topic-memories/${sanitized}.json`);
      }
    } catch (_e) {}
  }

  return true;
}

function updateSynthesisState(topicName, updates) {
  if (typeof window === 'undefined') return;
  if (!window._activeWorkstreamSyntheses) window._activeWorkstreamSyntheses = new Map();
  const current = window._activeWorkstreamSyntheses.get(topicName) || {
    percent: 0,
    label: '',
    status: 'running',
    logs: []
  };
  const updated = {
    ...current,
    ...updates,
    logs: updates.log ? [...(current.logs || []), updates.log] : (updates.logs || current.logs || [])
  };
  window._activeWorkstreamSyntheses.set(topicName, updated);
  if (typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('workstream-synthesis-progress', {
      detail: { topicName, state: updated }
    }));
  }
}
window.updateSynthesisState = updateSynthesisState;

/** Generate / Synthesize a Workstream Memory dossier using Secretary AI Agent */
async function synthesizeWorkstreamMemoryWithAI(majorTopic, options = {}) {
  if (!majorTopic || typeof majorTopic !== 'string') return null;
  const cleanTopicName = majorTopic.trim();
  if (!cleanTopicName) return null;

  updateSynthesisState(cleanTopicName, {
    percent: 15,
    label: typeof t === 'function' ? (t('workstream.synthesisStepScanning') || 'Scanning Notes & Context...') : 'Scanning Notes & Context...',
    status: 'running',
    logs: [`Initializing AI synthesis for workstream "${cleanTopicName}"...`]
  });

  // 1. Read existing memory dossier and mapped tags
  const existingMemory = await getMajorTopicMemory(cleanTopicName, { skipAutoArchive: true }) || {
    topicName: cleanTopicName,
    summary: '',
    keyFacts: [],
    activeMilestones: [],
    decisions: [],
    openThreads: [],
    participants: [],
    associatedNotes: [],
    scratchpad: '',
    status: 'active',
    pinned: false,
    mappedTags: { major_topic_tags: [cleanTopicName], topic_tags: [], group_tags: [] }
  };

  const mapped = existingMemory.mappedTags || { major_topic_tags: [cleanTopicName], topic_tags: [], group_tags: [] };
  const assignedMajors = Array.from(new Set([cleanTopicName, ...(mapped.major_topic_tags || [])])).map(t => String(t).toLowerCase());
  const assignedGroups = (mapped.group_tags || []).map(t => String(t).toLowerCase());
  const assignedTopics = (mapped.topic_tags || []).map(t => String(t).toLowerCase());

  // 2. Multi-Stage Discovery: Read all notes from manifest
  let allNotes = [];
  if (typeof manifest !== 'undefined' && Array.isArray(manifest)) {
    allNotes = manifest;
  } else if (typeof notesManifest !== 'undefined' && Array.isArray(notesManifest)) {
    allNotes = notesManifest;
  } else if (typeof notesDb !== 'undefined' && Array.isArray(notesDb.notes)) {
    allNotes = notesDb.notes;
  } else {
    try {
      if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNotesManifest === 'function') {
        const m = await StorageAPI.readNotesManifest();
        if (Array.isArray(m)) allNotes = m;
      }
    } catch (_e) {}
  }

  // 35-day window for recent notes (5 weeks)
  const now = Date.now();
  const recentCutoff = now - (35 * 24 * 60 * 60 * 1000);

  // Common European stopwords (en, fr, de, es, it)
  const stopWords = new Set([
    'pour', 'dans', 'avec', 'sur', 'par', 'les', 'des', 'une',
    'this', 'that', 'from', 'with', 'workstream', 'and', 'the', 'for', 'about',
    'und', 'der', 'die', 'das', 'fur', 'mit', 'von',
    'con', 'para', 'della', 'per', 'del', 'las', 'los'
  ]);

  // Extract search keywords
  const promptText = options.prompt || '';
  const searchKeywords = Array.from(new Set([
    ...cleanTopicName.toLowerCase().split(/[\s\-_\/]+/),
    ...promptText.toLowerCase().split(/[\s\-_\/]+/),
    ...assignedMajors,
    ...assignedGroups,
    ...assignedTopics
  ])).map(w => w.trim()).filter(w => w && w.length >= 3 && !stopWords.has(w));

  // 3. First-Pass Candidate Evaluation & Scoring
  const candidateScores = new Map();
  const directlyTagMatchedNoteIds = new Set();

  allNotes.forEach(n => {
    if (!n) return;
    const noteId = n.id || n.path || n.title;
    if (!noteId) return;

    const noteMajors = (n.major_topic_tags || []).map(t => String(t || '').toLowerCase());
    const noteGroups = (n.group_tags || []).map(t => String(t || '').toLowerCase());
    const noteTopics = (n.topic_tags || []).map(t => String(t || '').toLowerCase());
    const noteTitle = String(n.title || '').toLowerCase();
    const noteSummary = String(n.summary || '').toLowerCase();

    // Check if directly matched by assigned tags or selection groups
    const matchRes = (typeof matchTagsToWorkstreamSelectionGroups === 'function')
      ? matchTagsToWorkstreamSelectionGroups(n, mapped.tagGroups)
      : null;
    const hasTagGroupMatch = matchRes ? matchRes.matched : (mapped.tagGroups || []).some(tg => {
      if (!tg) return false;
      const g = (tg.group || '').trim().toLowerCase();
      const m = (tg.major || '').trim().toLowerCase();
      const t = (tg.topic || '').trim().toLowerCase();
      const isCatchAll = (!g || g === '*') && (!m || m === '*') && (!t || t === '*');
      if (isCatchAll) return true;
      const matchG = !g || g === '*' || noteGroups.includes(g);
      const matchM = !m || m === '*' || noteMajors.includes(m);
      const matchT = !t || t === '*' || noteTopics.includes(t);
      return matchG && matchM && matchT;
    });
    const hasMajorMatch = noteMajors.some(m => assignedMajors.includes(m));
    const hasGroupMatch = noteGroups.some(g => assignedGroups.includes(g));
    const hasTopicMatch = noteTopics.some(t => assignedTopics.includes(t));
    const hasTitleExactMatch = noteTitle.includes(cleanTopicName.toLowerCase());

    const isDirectTagMatch = hasTagGroupMatch || hasMajorMatch || hasGroupMatch || hasTopicMatch || hasTitleExactMatch;

    if (isDirectTagMatch) {
      directlyTagMatchedNoteIds.add(String(noteId));
    }

    // Check recency with robust date parser
    const noteDateStr = n.updatedAt || n.createdAt || n.mtime || n.created || n.date || '';
    const noteTime = parseFlexibleTimestamp(noteDateStr);
    const isRecent = noteTime > 0 && noteTime >= recentCutoff;

    // Keyword hits (bounded)
    let keywordHits = 0;
    searchKeywords.forEach(kw => {
      if (noteTitle.includes(kw)) keywordHits += 2;
      if (noteSummary.includes(kw)) keywordHits += 1;
      if (noteMajors.some(m => m.includes(kw)) || noteGroups.some(g => g.includes(kw)) || noteTopics.some(t => t.includes(kw))) keywordHits += 2;
    });

    let score = 0;
    if (isDirectTagMatch) score += 100;
    if (isRecent) score += 20;
    score += Math.min(60, keywordHits * 12);
    if (Array.isArray(n.decisions) && n.decisions.length > 0) score += 10;

    if (score > 0) {
      candidateScores.set(n, score);
    }
  });

  // Sort candidate notes by score descending
  const sortedCandidates = Array.from(candidateScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);

  // Select top candidates for deep inspection (up to 15 notes)
  const topNotes = sortedCandidates.slice(0, 15);

  // 4. Fetch Deep Content for Top Notes
  const notesContextList = [];
  for (const n of topNotes) {
    let noteText = '';
    try {
      if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.readNoteContent === 'function' && n.path) {
        noteText = await StorageAPI.readNoteContent(n.path);
      } else if (typeof readNoteContent === 'function') {
        noteText = await readNoteContent(n);
      } else if (n.content) {
        noteText = n.content;
      }
    } catch (_e) {}

    notesContextList.push({
      id: n.id || n.path || n.title,
      path: n.path || '',
      title: n.title || 'Untitled Note',
      date: n.updatedAt || n.createdAt || n.date || '',
      summary: n.summary || '',
      tags: {
        major: n.major_topic_tags || [],
        group: n.group_tags || [],
        topic: n.topic_tags || []
      },
      decisions: n.decisions || [],
      contentSnippet: (noteText || '').slice(0, 1800)
    });
  }

  // 5. Gather Active Decisions & Tasks
  let activeDecisions = [];
  try {
    const allDec = (typeof getAllMetadataDecisionEntries === 'function') ? getAllMetadataDecisionEntries() : (typeof decisionsList !== 'undefined' ? decisionsList : []);
    activeDecisions = (Array.isArray(allDec) ? allDec : []).filter(d => {
      if (!d) return false;
      const mTags = (d.major_topic_tags || []).map(t => String(t || '').toLowerCase());
      const gTags = (d.group_tags || []).map(t => String(t || '').toLowerCase());
      return mTags.some(m => assignedMajors.includes(m)) || gTags.some(g => assignedGroups.includes(g)) || String(d.text || d.title || '').toLowerCase().includes(cleanTopicName.toLowerCase());
    }).map(d => ({ noteId: d.noteId || '', text: d.text || d.title || '', status: d.status || 'active', impact: d.impact || 'normal' }));
  } catch (_e) {}

  let activeTasks = [];
  try {
    const rawTodos = (typeof todosManifest !== 'undefined' && Array.isArray(todosManifest))
      ? todosManifest
      : (typeof todosList !== 'undefined' && Array.isArray(todosList) ? todosList : []);
    activeTasks = (Array.isArray(rawTodos) ? rawTodos : []).filter(t => {
      if (!t) return false;
      const mTags = (t.major_topic_tags || []).map(tag => String(tag || '').toLowerCase());
      const gTags = (t.group_tags || []).map(tag => String(tag || '').toLowerCase());
      return mTags.some(m => assignedMajors.includes(m)) || gTags.some(g => assignedGroups.includes(g)) || String(t.title || t.text || '').toLowerCase().includes(cleanTopicName.toLowerCase());
    }).map(t => ({ id: t.id, title: t.title || t.text || '', completed: !!t.completed, dueDate: t.dueDate || '' }));
  } catch (_e) {}

  let activeEvents = [];
  try {
    const rawEvents = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) ? plannerEvents : [];
    activeEvents = rawEvents.filter(ev => {
      if (!ev) return false;
      const mTags = (ev.major_topic_tags || []).map(tag => String(tag || '').toLowerCase());
      const gTags = (ev.group_tags || []).map(tag => String(tag || '').toLowerCase());
      const tTags = (ev.topic_tags || []).map(tag => String(tag || '').toLowerCase());
      return mTags.some(m => assignedMajors.includes(m)) || gTags.some(g => assignedGroups.includes(g)) || tTags.some(t => assignedTopics.includes(t)) || String(ev.title || '').toLowerCase().includes(cleanTopicName.toLowerCase());
    }).map(ev => ({
      id: ev.id,
      title: ev.title || 'Untitled Session',
      type: ev.type || '',
      date: ev.date || '',
      startTime: ev.startTime || '',
      endTime: ev.endTime || '',
      collaborators: ev.collaborators || [],
      context: ev.context || ''
    }));
  } catch (_e) {}

  // 6. Call LLM Synthesis if available
  const onProgressCombined = (stage, data) => {
    if (stage === 'thinking' && data?.thinkingText) {
      updateSynthesisState(cleanTopicName, { log: `🧠 ${data.thinkingText}` });
    } else if (stage === 'synthesizing') {
      updateSynthesisState(cleanTopicName, { percent: 70, label: typeof t === 'function' ? (t('workstream.runningLlmSynthesis') || 'Running neural LLM synthesis...') : 'Running neural LLM synthesis...', log: `Analyzing ${data?.topNotesCount || 10} notes...` });
    }
    if (typeof options.onProgress === 'function') {
      try { options.onProgress(stage, data); } catch (_e) {}
    }
  };

  updateSynthesisState(cleanTopicName, {
    percent: 50,
    label: typeof t === 'function' ? (t('workstream.evaluatingContexts') || 'Evaluating notes & decision contexts...') : 'Evaluating notes & decision contexts...',
    log: `Found ${candidateScores.size} matching candidate notes. Running synthesis...`
  });

  const synthesisMode = options.synthesisMode || options.mode || 'incremental';
  const isResetMode = synthesisMode === 'reset' || synthesisMode === 'scratch' || synthesisMode === 'start_0';
  const memoryContextForLLM = isResetMode ? null : existingMemory;

  let generatedData = null;
  if (typeof LLMService !== 'undefined' && typeof LLMService.synthesizeWorkstreamMemory === 'function') {
    generatedData = await LLMService.synthesizeWorkstreamMemory(cleanTopicName, {
      notes: notesContextList,
      decisions: activeDecisions,
      tasks: activeTasks,
      events: activeEvents,
      existingMemory: memoryContextForLLM,
      userPrompt: options.prompt || '',
      userScopeAnswers: options.userScopeAnswers || options.scopingAnswers || null,
      synthesisMode: synthesisMode,
      signal: options.signal,
      onProgress: onProgressCombined
    });
  }

  // Intelligent fallback synthesis if LLM is offline
  if (!generatedData) {
    const aiSettings = (typeof settings !== 'undefined' && settings.ai) ? settings.ai : {};
    let targetLang = (aiSettings.language && aiSettings.language !== 'auto') ? aiSettings.language : 'auto';
    if (targetLang === 'auto') {
      const sampleText = ((cleanTopicName || '') + ' ' + notesContextList.map(n => (n.title || '') + ' ' + (n.summary || '') + ' ' + (n.contentSnippet || '')).join(' ') + ' ' + promptText);
      targetLang = (typeof detectTextLanguage === 'function')
        ? detectTextLanguage(sampleText, typeof getAppLanguage === 'function' ? getAppLanguage() : 'en')
        : (typeof getAppLanguage === 'function' ? getAppLanguage() : 'en');
    }

    const recentSummaries = notesContextList.filter(n => n.summary).map(n => n.summary);
    const escFn = typeof escH === 'function' ? escH : (s => String(s || ''));

    let oneSentence = '';
    let fallbackSummary = '';
    let fallbackFacts = [];
    let fallbackScratchpad = '';

    if (targetLang === 'fr') {
      oneSentence = recentSummaries.length > 0
        ? `Workstream "${cleanTopicName}" : ${recentSummaries[0]}`
        : `Initiatives opérationnelles, décisions et tâches coordonnées sous "${cleanTopicName}".`;
      fallbackSummary = `<p>${escFn(oneSentence)}</p><ul><li><strong>In-scope:</strong> Initiatives actives, décisions opérationnelles, livrables et notes liés à ${escFn(cleanTopicName)}.</li><li><strong>Out-of-scope:</strong> Projets non liés, initiatives externes et sujets obsolètes.</li></ul>`;
      fallbackFacts = [
        ...(existingMemory?.keyFacts || []),
        ...notesContextList.slice(0, 4).map(n => `Note : "${n.title}" (${n.date || 'récemment mis à jour'})`),
        ...activeDecisions.slice(0, 3).map(d => `Décision : ${d.text}`)
      ].filter(Boolean);
      fallbackScratchpad = existingMemory?.scratchpad || `<h2>Scope & Boundaries</h2>
<ul>
  <li><strong>In-Scope:</strong> Initiatives actives, décisions opérationnelles et notes liées à "${escFn(cleanTopicName)}".</li>
  <li><strong>Out-of-Scope / Non-Goals:</strong> Projets non liés et sujets obsolètes.</li>
</ul>

<h2>Chronology & What Happened</h2>
<ul>
  <li>Dossier de Workstream synthétisé avec ${notesContextList.length} notes candidates et ${activeDecisions.length} décisions.</li>
  <li>Initialisation de la mémoire le ${new Date().toLocaleDateString('fr-FR')}.</li>
</ul>

<h2>Decisions Taken & Direct Impact</h2>
${activeDecisions.length > 0 ? `<ul>${activeDecisions.map(d => `<li><strong>[${escFn((d.impact || 'normal').toUpperCase())}]</strong> ${escFn(d.text)}</li>`).join('')}</ul>` : '<p><em>Aucune décision critique enregistrée pour l\'instant.</em></p>'}

<h2>Tasks Done & Active Deliverables</h2>
${activeTasks.length > 0 ? `<ul>${activeTasks.map(t => `<li><strong>[${t.completed ? 'TERMINÉ' : 'EN COURS'}]</strong> ${escFn(t.title)}</li>`).join('')}</ul>` : '<p><em>Actions initiales en attente.</em></p>'}

<h2>Agent Strategic Notes & Key Insights</h2>
<ul>
  <li>Agent IA Secretary connecté au Workstream "${escFn(cleanTopicName)}".</li>
  <li>Surveillance active : alignement des livrables et suivi des dépendances.</li>
</ul>`;
    } else if (targetLang === 'de') {
      oneSentence = recentSummaries.length > 0
        ? `Themenfeld "${cleanTopicName}": ${recentSummaries[0]}`
        : `Operative Initiativen, Entscheidungen und Aufgaben unter "${cleanTopicName}".`;
      fallbackSummary = `<p>${escFn(oneSentence)}</p><ul><li><strong>In-scope:</strong> Aktive Initiativen, operative Entscheidungen, Liefergegenstände und Notizen zu ${escFn(cleanTopicName)}.</li><li><strong>Out-of-scope:</strong> Nicht bezogene Projekte, externe Vorhaben und veraltete Themen.</li></ul>`;
      fallbackFacts = [
        ...(existingMemory?.keyFacts || []),
        ...notesContextList.slice(0, 4).map(n => `Notiz: "${n.title}" (${n.date || 'kürzlich aktualisiert'})`),
        ...activeDecisions.slice(0, 3).map(d => `Entscheidung: ${d.text}`)
      ].filter(Boolean);
      fallbackScratchpad = existingMemory?.scratchpad || `<h2>Scope & Boundaries</h2>
<ul>
  <li><strong>In-Scope:</strong> Aktive Initiativen, operative Entscheidungen und Notizen zu "${escFn(cleanTopicName)}".</li>
  <li><strong>Out-of-Scope / Non-Goals:</strong> Nicht bezogene Projekte und veraltete Themen.</li>
</ul>

<h2>Chronology & What Happened</h2>
<ul>
  <li>Workstream-Dossier erstellt mit ${notesContextList.length} Notizen und ${activeDecisions.length} Entscheidungen.</li>
  <li>Initialisierung des Speichers am ${new Date().toLocaleDateString('de-DE')}.</li>
</ul>

<h2>Decisions Taken & Direct Impact</h2>
${activeDecisions.length > 0 ? `<ul>${activeDecisions.map(d => `<li><strong>[${escFn((d.impact || 'normal').toUpperCase())}]</strong> ${escFn(d.text)}</li>`).join('')}</ul>` : '<p><em>Noch keine kritischen Entscheidungen protokolliert.</em></p>'}

<h2>Tasks Done & Active Deliverables</h2>
${activeTasks.length > 0 ? `<ul>${activeTasks.map(t => `<li><strong>[${t.completed ? 'ERLEDIGT' : 'IN BEARBEITUNG'}]</strong> ${escFn(t.title)}</li>`).join('')}</ul>` : '<p><em>Erste Maßnahmen ausstehend.</em></p>'}

<h2>Agent Strategic Notes & Key Insights</h2>
<ul>
  <li>Secretary KI-Agent verbunden mit Themenfeld "${escFn(cleanTopicName)}".</li>
  <li>Fokus: Meilensteine koordinieren und Abhängigkeiten überwachen.</li>
</ul>`;
    } else {
      oneSentence = recentSummaries.length > 0
        ? `Workstream "${cleanTopicName}": ${recentSummaries[0]}`
        : `Operational initiatives, decisions, and tasks coordinated under "${cleanTopicName}".`;
      fallbackSummary = `<p>${escFn(oneSentence)}</p><ul><li><strong>In-scope:</strong> Active initiatives, operational decisions, deliverables, and notes linked to ${escFn(cleanTopicName)}.</li><li><strong>Out-of-scope:</strong> Unrelated projects, external initiatives, and legacy deprecated threads.</li></ul>`;
      fallbackFacts = [
        ...(existingMemory?.keyFacts || []),
        ...notesContextList.slice(0, 4).map(n => `Note: "${n.title}" (${n.date || 'recently updated'})`),
        ...activeDecisions.slice(0, 3).map(d => `Decision: ${d.text}`)
      ].filter(Boolean);
      fallbackScratchpad = existingMemory?.scratchpad || `<h2>Scope & Boundaries</h2>
<ul>
  <li><strong>In-Scope:</strong> Active initiatives, operational decisions, and notes related to "${escFn(cleanTopicName)}".</li>
  <li><strong>Out-of-Scope / Non-Goals:</strong> Unrelated projects and deprecated legacy threads.</li>
</ul>

<h2>Chronology & What Happened</h2>
<ul>
  <li>Workstream dossier synthesized with ${notesContextList.length} candidate notes and ${activeDecisions.length} decisions.</li>
  <li>Initial monitoring initialized on ${new Date().toLocaleDateString()}.</li>
</ul>

<h2>Decisions Taken & Direct Impact</h2>
${activeDecisions.length > 0 ? `<ul>${activeDecisions.map(d => `<li><strong>[${escFn((d.impact || 'normal').toUpperCase())}]</strong> ${escFn(d.text)}</li>`).join('')}</ul>` : '<p><em>No critical decisions logged yet.</em></p>'}

<h2>Tasks Done & Active Deliverables</h2>
${activeTasks.length > 0 ? `<ul>${activeTasks.map(t => `<li><strong>[${t.completed ? 'DONE' : 'IN PROGRESS'}]</strong> ${escFn(t.title)}</li>`).join('')}</ul>` : '<p><em>Initial action items pending assignment.</em></p>'}

<h2>Agent Strategic Notes & Key Insights</h2>
<ul>
  <li>Secretary AI Agent connected to workstream "${escFn(cleanTopicName)}".</li>
  <li>Ongoing focus: track cross-functional dependencies, align deliverables, and ensure milestone delivery.</li>
</ul>`;
    }

    generatedData = {
      summary: fallbackSummary,
      oneSentenceSummary: oneSentence,
      keyFacts: Array.from(new Set(fallbackFacts)).slice(0, 6),
      activeMilestones: existingMemory?.activeMilestones || activeTasks.slice(0, 4).map(t => ({ title: t.title, status: t.completed ? 'completed' : 'in_progress', dueDate: t.dueDate || 'TBD' })),
      decisions: activeDecisions.map(d => d.text),
      openThreads: existingMemory?.openThreads || [],
      participants: existingMemory?.participants || [],
      scratchpad: fallbackScratchpad,
      associatedNoteIds: topNotes.map(n => n.id || n.path || n.title)
    };
  }

  // 7. Associate Notes: Merge all directly tag-matched notes + AI identified notes
  const associatedNotesMap = new Map();
  (existingMemory?.associatedNotes || []).forEach(an => {
    if (an && (an.id || an.path || an.title)) {
      associatedNotesMap.set(an.id || an.path || an.title, an);
    }
  });

  // Add all tag-matched notes (by definition associated)
  allNotes.forEach(n => {
    const noteId = n.id || n.path || n.title;
    if (noteId && directlyTagMatchedNoteIds.has(noteId)) {
      associatedNotesMap.set(noteId, {
        id: n.id || n.path || n.title,
        path: n.path || '',
        title: n.title || 'Untitled Note',
        date: n.updatedAt || n.createdAt || n.date || '',
        summary: n.summary || ''
      });
    }
  });

  // Add notes explicitly identified in AI response
  const aiNoteIds = new Set(generatedData.associatedNoteIds || []);
  topNotes.forEach(n => {
    const noteId = n.id || n.path || n.title;
    if (noteId && (aiNoteIds.has(noteId) || aiNoteIds.has(n.path) || aiNoteIds.has(n.title))) {
      associatedNotesMap.set(noteId, {
        id: n.id || n.path || n.title,
        path: n.path || '',
        title: n.title || 'Untitled Note',
        date: n.updatedAt || n.createdAt || n.date || '',
        summary: n.summary || ''
      });
    }
  });

  // If map is still empty, include top 5 scored notes
  if (associatedNotesMap.size === 0) {
    topNotes.slice(0, 5).forEach(n => {
      const noteId = n.id || n.path || n.title;
      if (noteId) {
        associatedNotesMap.set(noteId, {
          id: n.id || n.path || n.title,
          path: n.path || '',
          title: n.title || 'Untitled Note',
          date: n.updatedAt || n.createdAt || n.date || '',
          summary: n.summary || ''
        });
      }
    });
  }

  const payload = {
    ...existingMemory,
    topicName: cleanTopicName,
    summary: generatedData.summary || (isResetMode ? '' : (existingMemory?.summary || '')),
    oneSentenceSummary: generatedData.oneSentenceSummary || (generatedData.summary ? String(generatedData.summary).split(/(?<=[.!?])\s+/)[0] : ''),
    keyFacts: Array.isArray(generatedData.keyFacts) ? generatedData.keyFacts : (isResetMode ? [] : (existingMemory?.keyFacts || [])),
    activeMilestones: Array.isArray(generatedData.activeMilestones) ? generatedData.activeMilestones : (isResetMode ? [] : (existingMemory?.activeMilestones || [])),
    decisions: Array.isArray(generatedData.decisions) ? generatedData.decisions : (isResetMode ? [] : (existingMemory?.decisions || [])),
    openThreads: Array.isArray(generatedData.openThreads) ? generatedData.openThreads : (isResetMode ? [] : (existingMemory?.openThreads || [])),
    participants: Array.isArray(generatedData.participants) ? generatedData.participants : (isResetMode ? [] : (existingMemory?.participants || [])),
    scratchpad: generatedData.scratchpad || (isResetMode ? '' : (existingMemory?.scratchpad || '')),
    associatedNotes: Array.from(associatedNotesMap.values()),
    status: existingMemory?.status || 'active',
    pinned: existingMemory?.pinned || false,
    lastUpdated: new Date().toISOString()
  };

  const saved = await saveMajorTopicMemory(cleanTopicName, payload);
  updateSynthesisState(cleanTopicName, {
    percent: 100,
    label: typeof t === 'function' ? (t('workstream.synthesisStepComplete') || 'Memory Ready!') : 'Memory Ready!',
    status: 'completed',
    log: 'Synthesis complete! Workstream memory saved.'
  });
  setTimeout(() => {
    if (window._activeWorkstreamSyntheses) {
      window._activeWorkstreamSyntheses.delete(cleanTopicName);
    }
  }, 3000);
  return saved;
}
window.synthesizeWorkstreamMemoryWithAI = synthesizeWorkstreamMemoryWithAI;

// ── Workstream Chat Persistence & Management ──

function getWorkstreamChatPath(topicName) {
  const sanitized = sanitizeTopicMemoryKey(topicName);
  return sanitized ? `raw/topic-memories/${sanitized}_chat.json` : '';
}

function getWorkstreamChatLsKey(topicName) {
  const sanitized = sanitizeTopicMemoryKey(topicName);
  return sanitized ? `secretary_ws_chat_${sanitized}` : '';
}

async function loadWorkstreamChat(topicName) {
  if (!topicName) return { topicName: '', topicKey: '', messages: [], lastUpdated: new Date().toISOString() };
  const sanitized = sanitizeTopicMemoryKey(topicName);
  const filePath = getWorkstreamChatPath(topicName);
  const lsKey = getWorkstreamChatLsKey(topicName);

  let chatData = null;

  if (typeof StorageAPI !== 'undefined' && StorageAPI.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
    try {
      const remoteChat = await window.FirebaseSyncService.getDoc('workstream_chat', sanitized);
      if (remoteChat && Array.isArray(remoteChat.messages)) {
        chatData = remoteChat;
      }
    } catch (_e) {}
  } else {
    try {
      if (typeof readFile === 'function') {
        const content = await readFile(filePath);
        if (content) chatData = JSON.parse(content);
      }
    } catch (_e) {}
  }

  if (!chatData || !Array.isArray(chatData.messages)) {
    try {
      const cached = localStorage.getItem(lsKey);
      if (cached) chatData = JSON.parse(cached);
    } catch (_e) {}
  }

  if (!chatData || typeof chatData !== 'object') {
    chatData = {
      topicName,
      topicKey: sanitized,
      messages: [],
      lastUpdated: new Date().toISOString()
    };
  }

  if (!Array.isArray(chatData.messages)) chatData.messages = [];
  return chatData;
}

async function saveWorkstreamChat(topicName, chatData) {
  if (!topicName || !chatData) return;
  const sanitized = sanitizeTopicMemoryKey(topicName);
  const filePath = getWorkstreamChatPath(topicName);
  const lsKey = getWorkstreamChatLsKey(topicName);

  const payload = {
    topicName,
    topicKey: sanitized,
    thinkingEffort: chatData.thinkingEffort || 'medium',
    messages: Array.isArray(chatData.messages) ? chatData.messages : [],
    lastUpdated: new Date().toISOString()
  };

  const jsonStr = JSON.stringify(payload, null, 2);

  try {
    localStorage.setItem(lsKey, jsonStr);
  } catch (_e) {}

  if (typeof StorageAPI !== 'undefined' && StorageAPI.getStorageEngine() === 'firebase' && typeof window !== 'undefined' && window.FirebaseSyncService?.state?.isUnlocked) {
    try {
      await window.FirebaseSyncService.putDoc('workstream_chat', sanitized, payload);
    } catch (_e) {}
  } else {
    try {
      if (typeof writeFile === 'function') {
        await writeFile(filePath, jsonStr);
      }
    } catch (_e) {}
  }

  return payload;
}

async function clearWorkstreamChat(topicName) {
  if (!topicName) return;
  const sanitized = sanitizeTopicMemoryKey(topicName);
  const payload = {
    topicName,
    topicKey: sanitized,
    messages: [],
    lastUpdated: new Date().toISOString()
  };
  await saveWorkstreamChat(topicName, payload);
  return payload;
}

// ── Workstream Calendar & Meetings Detection Engine ──

function getWorkstreamMeetings(topicName, options = {}) {
  if (!topicName) return { upcoming: [], past: [] };
  const cleanName = String(topicName).trim().toLowerCase();
  const rawEvents = (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents))
    ? plannerEvents
    : ((typeof window !== 'undefined' && Array.isArray(window.plannerEvents)) ? window.plannerEvents : []);

  const memory = options.memory || (_topicMemoriesIndexCache?.topics?.find(t => (t.topicName || '').toLowerCase() === cleanName || t.key === sanitizeTopicMemoryKey(topicName))) || null;
  const memoryParticipants = Array.isArray(memory?.participants) ? memory.participants.map(p => String(p).toLowerCase().trim()) : [];
  const memoryNotes = Array.isArray(memory?.associatedNotes) ? memory.associatedNotes.map(n => String(typeof n === 'string' ? n : (n?.id || n?.path || n?.title || '')).toLowerCase().trim()) : [];

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const matched = [];

  rawEvents.forEach(evt => {
    if (!evt || evt.type === 'prep' || !evt.date) return;
    const evtTitle = String(evt.title || '').toLowerCase();
    const evtDesc = String(evt.description || '').toLowerCase();
    const evtWs = String(evt.workstream || '').toLowerCase();
    const evtMajors = (evt.major_topic_tags || []).map(t => String(t).toLowerCase().trim());
    const evtGroups = (evt.group_tags || []).map(t => String(t).toLowerCase().trim());
    const evtNoteId = String(evt.noteId || '').toLowerCase().trim();
    const evtLinkedNotes = (evt.linkedNoteIds || []).map(n => String(n).toLowerCase().trim());
    const evtCollabs = [...(evt.collaborators || []), ...(evt.collaboratorIds || [])].map(c => String(c).toLowerCase().trim());

    // 1. Direct tag / workstream match
    const directMatch = evtWs === cleanName || evtMajors.includes(cleanName) || evtTitle.includes(cleanName);

    // 2. Note match
    const noteMatch = (evtNoteId && memoryNotes.includes(evtNoteId)) || evtLinkedNotes.some(ln => memoryNotes.includes(ln));

    // 3. Participant + keyword match
    const collabMatch = memoryParticipants.length > 0 && evtCollabs.some(c => memoryParticipants.includes(c)) && (evtTitle.includes(cleanName) || evtDesc.includes(cleanName) || directMatch);

    if (directMatch || noteMatch || collabMatch) {
      matched.push(evt);
    }
  });

  const upcoming = matched.filter(e => String(e.date || '') >= todayStr).sort((a, b) => {
    const dCmp = String(a.date || '').localeCompare(String(b.date || ''));
    if (dCmp !== 0) return dCmp;
    return String(a.startTime || '').localeCompare(String(b.startTime || ''));
  });

  const past = matched.filter(e => String(e.date || '') < todayStr).sort((a, b) => {
    const dCmp = String(b.date || '').localeCompare(String(a.date || ''));
    if (dCmp !== 0) return dCmp;
    return String(b.startTime || '').localeCompare(String(a.startTime || ''));
  }).slice(0, 20);

  return { upcoming, past, all: matched, suggestions: memory?.suggestedMeetings || [] };
}

// ── AI Language Resolution Helper ──

function getWorkstreamAiLanguageInfo(contextSampleText = '') {
  let lang = 'en';
  if (typeof settings !== 'undefined' && settings) {
    if (settings.ai && settings.ai.language && settings.ai.language !== 'auto') {
      lang = settings.ai.language;
    } else if (contextSampleText && typeof detectTextLanguage === 'function') {
      lang = detectTextLanguage(contextSampleText, settings.language || 'en');
    } else if (settings.language) {
      lang = settings.language;
    }
  }
  lang = String(lang).toLowerCase().split('-')[0];
  const langNames = (typeof APP_LANGUAGE_NAMES !== 'undefined') ? APP_LANGUAGE_NAMES : {
    en: 'English',
    de: 'Deutsch (German)',
    fr: 'Français (French)',
    cs: 'Čeština (Czech)',
    es: 'Español (Spanish)',
    hu: 'Magyar (Hungarian)',
    it: 'Italiano (Italian)',
    nl: 'Nederlands (Dutch)',
    pl: 'Polski (Polish)',
    pt: 'Português (Portuguese)',
    ro: 'Română (Romanian)',
    ru: 'Русский (Russian)',
    sv: 'Svenska (Swedish)',
    tr: 'Türkçe (Turkish)',
    uk: 'Українська (Ukrainian)'
  };
  const langCode = langNames[lang] ? lang : 'en';
  return {
    code: langCode,
    name: langNames[langCode] || 'English'
  };
}

// ── Meeting Agenda & Topics Generator (AI Briefing) ──

async function generateMeetingAgendaWithAI(topicName, meetingEvent, options = {}) {
  if (!meetingEvent) return null;
  const memory = (options.memory || await getMajorTopicMemory(topicName, { skipAutoArchive: true })) || {};
  const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();

  const title = meetingEvent.title || 'Meeting';
  const date = meetingEvent.date || '';
  const time = `${meetingEvent.startTime || ''} - ${meetingEvent.endTime || ''}`;
  const participants = [...(meetingEvent.collaborators || []), ...(meetingEvent.collaboratorIds || [])].filter(Boolean);

  const openThreads = Array.isArray(memory.openThreads) ? memory.openThreads : [];
  const proposedDecisions = (Array.isArray(memory.decisions) ? memory.decisions : []).filter(d => (d.status || 'active') === 'proposed');
  const activeMilestones = Array.isArray(memory.activeMilestones) ? memory.activeMilestones : [];

  const langInfo = getWorkstreamAiLanguageInfo(`${topicName} ${title} ${memory.summary || ''}`);

  if (isAIEnabled) {
    try {
      const prompt = `You are the Secretary AI Executive Assistant and Meeting Architect for the Workstream "${topicName}".
Your mission is to generate a high-impact, highly actionable, structured meeting preparation briefing and agenda for the following session:

Meeting Title: "${title}"
Date & Time: ${date} (${time})
Attendees: ${participants.length > 0 ? participants.join(', ') : 'Workstream Team'}

Workstream Strategic Context:
- Scope / Core Mission: ${memory.summary || 'General workstream alignment'}
- Open Threads & Unresolved Questions: ${openThreads.length > 0 ? openThreads.join(' | ') : 'None logged'}
- Proposed Decisions Pending Validation: ${proposedDecisions.length > 0 ? proposedDecisions.map(d => typeof d === 'string' ? d : d.text).join(' | ') : 'None'}
- Active Milestones & Deliverables: ${activeMilestones.length > 0 ? activeMilestones.map(m => typeof m === 'string' ? m : m.title).join(' | ') : 'None'}

MANDATORY LANGUAGE DIRECTIVE:
You MUST formulate all generated text (objective, talking points, decisions to validate, critical risks) in ${langInfo.name}.

OUTPUT FORMAT:
You MUST return STRICT JSON matching this schema:
{
  "objective": "Clear, razor-sharp 1-sentence primary objective for this session in ${langInfo.name}",
  "talkingPoints": ["Itemized point 1 to address", "Itemized point 2", "Itemized point 3"],
  "decisionsToValidate": ["Specific decision or arbitration to validate with attendees", "Arbitration 2"],
  "criticalTasksOrRisks": ["Vigilance point or risk 1", "Verification 2"]
}`;

      const res = await LLMService.chat([
        { role: 'system', content: `You are an elite executive Chief of Staff and strategic project architect. You respond exclusively in valid JSON in ${langInfo.name}.` },
        { role: 'user', content: prompt }
      ], { temperature: 0.3 });

      if (res && res.parsed && typeof res.parsed === 'object') {
        return {
          title,
          date,
          time,
          participants,
          objective: res.parsed.objective || `Strategic alignment on ${topicName}`,
          talkingPoints: Array.isArray(res.parsed.talkingPoints) ? res.parsed.talkingPoints : [],
          decisionsToValidate: Array.isArray(res.parsed.decisionsToValidate) ? res.parsed.decisionsToValidate : [],
          criticalTasksOrRisks: Array.isArray(res.parsed.criticalTasksOrRisks) ? res.parsed.criticalTasksOrRisks : []
        };
      }
    } catch (e) {
      console.warn('AI Agenda generation fallback:', e);
    }
  }

  // Fallback heuristic generator
  const fallbackPoints = [];
  if (openThreads.length > 0) {
    openThreads.slice(0, 3).forEach(t => fallbackPoints.push(typeof t === 'string' ? t : JSON.stringify(t)));
  }
  if (proposedDecisions.length > 0) {
    proposedDecisions.slice(0, 2).forEach(d => fallbackPoints.push(typeof d === 'string' ? d : d.text));
  }
  if (fallbackPoints.length === 0) {
    fallbackPoints.push(`Review overall progress on Workstream "${topicName}"`);
    fallbackPoints.push(`Verify upcoming milestones and assign next action items`);
  }

  return {
    title,
    date,
    time,
    participants,
    objective: `Align team and unblock open questions on ${topicName}`,
    talkingPoints: fallbackPoints,
    decisionsToValidate: proposedDecisions.map(d => typeof d === 'string' ? d : d.text).slice(0, 3),
    criticalTasksOrRisks: openThreads.slice(0, 2).map(t => typeof t === 'string' ? t : JSON.stringify(t))
  };
}

// ── Proactive Meeting Suggestion Engine ──

async function suggestWorkstreamMeetingsWithAI(topicName, options = {}) {
  const memory = (options.memory || await getMajorTopicMemory(topicName, { skipAutoArchive: true })) || {};
  
  // Return saved suggestions immediately if available and not explicitly forcing a refresh
  if (options.forceRefresh !== true && Array.isArray(memory.suggestedMeetings) && memory.suggestedMeetings.length > 0) {
    return memory.suggestedMeetings;
  }

  const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();

  const openThreads = Array.isArray(memory.openThreads) ? memory.openThreads : [];
  const proposedDecisions = (Array.isArray(memory.decisions) ? memory.decisions : []).filter(d => (d.status || 'active') === 'proposed');
  const participants = Array.isArray(memory.participants) ? memory.participants : [];
  const activeMilestones = Array.isArray(memory.activeMilestones) ? memory.activeMilestones : [];

  // Fetch upcoming scheduled meetings for this workstream from calendar
  const wsMeetings = typeof getWorkstreamMeetings === 'function' ? getWorkstreamMeetings(topicName, { memory }) : { upcoming: [] };
  const upcomingMeetings = Array.isArray(wsMeetings?.upcoming) ? wsMeetings.upcoming : [];
  const upcomingFormatted = upcomingMeetings.map(m => {
    const pList = [...(m.collaborators || []), ...(m.collaboratorIds || [])].filter(Boolean).join(', ');
    return `- [ID: ${m.id || ''}] "${m.title || 'Meeting'}" on ${m.date || ''} ${m.startTime || ''}${pList ? ` with ${pList}` : ''}${m.description ? ` (Details: ${m.description.slice(0, 160)})` : ''}`;
  }).join('\n') || 'None scheduled';

  const langInfo = getWorkstreamAiLanguageInfo(`${topicName} ${memory.summary || ''}`);

  let suggestions = [];

  if (isAIEnabled && (openThreads.length > 0 || proposedDecisions.length > 0 || activeMilestones.length > 0 || upcomingMeetings.length > 0)) {
    try {
      const prompt = `You are the Secretary AI Executive Project Officer for the Workstream "${topicName}".
Analyze the current state of this Workstream to proactively identify high-value meetings or context enrichments needed to unblock milestones, settle open questions, and accelerate delivery.

Context:
- Team Members & Stakeholders: ${participants.join(', ') || 'Workstream Team'}
- Unresolved Open Threads & Blockers: ${openThreads.map(q => '- ' + q).join('\n') || 'None'}
- Proposed Decisions Pending Validation: ${proposedDecisions.map(d => '- ' + (typeof d === 'string' ? d : d.text)).join('\n') || 'None'}
- Active Milestones & Goals: ${activeMilestones.map(m => '- ' + (typeof m === 'string' ? m : m.title)).join('\n') || 'None'}
- Already Scheduled Upcoming Calendar Meetings:
${upcomingFormatted}

ANALYSIS GUIDELINES:
1. FIRST check if an upcoming scheduled meeting probably ALREADY covers an open thread, blocker, or milestone (or shares the relevant stakeholders).
   - If an upcoming meeting covers it: do NOT schedule a redundant new meeting. Instead, propose "enrich_existing" to ask/add strategic context & agenda to that upcoming meeting.
2. If NO upcoming meeting covers the needed alignment:
   - Propose "new_meeting" and guess the strategic context, attendees, estimated duration, and agenda.

MANDATORY LANGUAGE DIRECTIVE:
You MUST formulate all meeting titles, reasons, context, and agendas in ${langInfo.name}.

Suggest 1 or 2 essential proposals in strict JSON:
{
  "suggestions": [
    {
      "proposalType": "new_meeting",
      "title": "Clear, professional meeting title in ${langInfo.name}",
      "targetParticipants": ["Person 1", "Person 2"],
      "durationMinutes": 30,
      "reason": "Clear strategic rationale explaining why this meeting is needed in ${langInfo.name}",
      "agenda": [
        "1. Point A to discuss",
        "2. Point B to discuss",
        "3. Final decision & alignment"
      ],
      "proposedContext": "Executive briefing summary in ${langInfo.name}"
    },
    {
      "proposalType": "enrich_existing",
      "existingMeetingId": "ID of the upcoming meeting",
      "existingMeetingTitle": "Title of the upcoming meeting",
      "existingMeetingDate": "YYYY-MM-DD",
      "title": "Context proposal for: Title",
      "reason": "Why this upcoming meeting is ideal to address the open blocker in ${langInfo.name}",
      "proposedContext": "Suggested strategic context and questions to add to this meeting in ${langInfo.name}",
      "agenda": [
        "1. Dedicated discussion on blocker X",
        "2. Alignment on decision Y"
      ]
    }
  ]
}`;

      const res = await LLMService.chat([
        { role: 'system', content: `You are an elite proactive PMO and strategic leader. You respond exclusively in valid JSON in ${langInfo.name}.` },
        { role: 'user', content: prompt }
      ], { temperature: 0.3 });

      if (res && res.parsed && Array.isArray(res.parsed.suggestions) && res.parsed.suggestions.length > 0) {
        suggestions = res.parsed.suggestions.map(s => {
          // Normalize proposal structure
          const isEnrich = s.proposalType === 'enrich_existing' || (s.existingMeetingId && upcomingMeetings.some(um => um.id === s.existingMeetingId));
          return {
            ...s,
            proposalType: isEnrich ? 'enrich_existing' : 'new_meeting',
            targetParticipants: Array.isArray(s.targetParticipants) ? s.targetParticipants : (participants.slice(0, 2)),
            durationMinutes: Number(s.durationMinutes) || 30,
            agenda: Array.isArray(s.agenda) ? s.agenda : []
          };
        });
      }
    } catch (e) {
      console.warn('AI Meeting suggestion fallback:', e);
    }
  }

  // Fallback heuristic suggestions if AI didn't return any
  if (!suggestions || suggestions.length === 0) {
    if (proposedDecisions.length > 0 || openThreads.length > 0 || activeMilestones.length > 0) {
      const targetPeople = participants.slice(0, 2);
      const mainQuestion = openThreads[0] || (proposedDecisions[0] ? `Arbitrage: ${proposedDecisions[0].text}` : (activeMilestones[0] ? `Milestone: ${activeMilestones[0].title || activeMilestones[0]}` : 'Strategic Alignment'));
      
      if (upcomingMeetings.length > 0) {
        const nextMeeting = upcomingMeetings[0];
        suggestions = [{
          proposalType: 'enrich_existing',
          existingMeetingId: nextMeeting.id || '',
          existingMeetingTitle: nextMeeting.title || 'Upcoming Meeting',
          existingMeetingDate: nextMeeting.date || '',
          title: `Agenda Context: ${nextMeeting.title || topicName}`,
          reason: `Upcoming meeting "${nextMeeting.title || 'Meeting'}" on ${nextMeeting.date || 'calendar'} is already scheduled and can cover "${mainQuestion}".`,
          proposedContext: `Address open topic "${mainQuestion}" and align on execution next steps.`,
          agenda: [
            `Review context & status for "${mainQuestion}"`,
            `Agree on resolution and next action items`
          ]
        }];
      } else {
        suggestions = [{
          proposalType: 'new_meeting',
          title: `Alignment & Decision Point: ${topicName}`,
          targetParticipants: targetPeople.length > 0 ? targetPeople : ['Team'],
          durationMinutes: 30,
          reason: `Required to settle: "${mainQuestion}" and unlock subsequent deliverables.`,
          proposedContext: `Strategic meeting to resolve blocker "${mainQuestion}".`,
          agenda: [
            `Review context & constraints for "${mainQuestion}"`,
            `Discuss actionable options with ${targetPeople.join(' & ') || 'stakeholders'}`,
            `Formalize decision and assign execution owners`
          ]
        }];
      }
    }
  }

  // Persist generated suggestions into topic memory dossier so they remain saved across tab switches
  if (Array.isArray(suggestions) && suggestions.length > 0 && typeof saveMajorTopicMemory === 'function') {
    try {
      const fullMemory = (await getMajorTopicMemory(topicName, { skipAutoArchive: true })) || memory;
      await saveMajorTopicMemory(topicName, {
        ...fullMemory,
        suggestedMeetings: suggestions
      });
    } catch (_e) {
      console.warn('Could not persist suggested meetings to topic memory:', _e);
    }
  }

  return suggestions;
}

// ── Post-Meeting Note Sync & Reconciliation Engine ──

async function syncPostMeetingWithAI(topicName, meetingEvent, noteContent, options = {}) {
  if (!noteContent) return null;
  const memory = (options.memory || await getMajorTopicMemory(topicName, { skipAutoArchive: true })) || {};
  const isAIEnabled = typeof LLMService !== 'undefined' && LLMService.isEnabled();

  const langInfo = getWorkstreamAiLanguageInfo(`${topicName} ${meetingEvent?.title || ''} ${noteContent.slice(0, 500)}`);

  if (isAIEnabled) {
    try {
      const prompt = `You are the Secretary AI Knowledge Manager for the Workstream "${topicName}".
Analyze the notes and minutes taken during the meeting "${meetingEvent?.title || 'Meeting'}" and reconcile them with the active Workstream memory:

Meeting Notes & Minutes:
${noteContent}

Current Workstream State:
- Open Threads: ${JSON.stringify(memory.openThreads || [])}
- Proposed Decisions: ${JSON.stringify((memory.decisions || []).filter(d => d.status === 'proposed'))}
- Key Facts: ${JSON.stringify(memory.keyFacts || [])}

MANDATORY LANGUAGE DIRECTIVE:
You MUST formulate all extracted facts, tasks, and items in ${langInfo.name}.

Identify and extract in strict JSON:
1. "resolvedThreads": Open threads that were resolved or settled during this meeting (to be closed from openThreads).
2. "validatedDecisions": Proposed decisions that were officially validated or agreed upon (to be promoted to "active" status).
3. "newFacts": Newly established key facts, milestone updates, or strategic outcomes in ${langInfo.name}.
4. "newTasks": Newly agreed action items with assignees and target due dates.

JSON Schema:
{
  "resolvedThreads": ["Resolved item 1"],
  "validatedDecisions": ["Validated decision 1"],
  "newFacts": ["New key fact 1"],
  "newTasks": [{"title": "Action item 1 in ${langInfo.name}", "assignee": "Name", "dueDate": "YYYY-MM-DD"}]
}`;

      const res = await LLMService.chat([
        { role: 'system', content: `You are an expert knowledge reconciler and project memory manager. You respond exclusively in valid JSON in ${langInfo.name}.` },
        { role: 'user', content: prompt }
      ], { temperature: 0.2 });

      if (res && res.parsed && typeof res.parsed === 'object') {
        return res.parsed;
      }
    } catch (e) {
      console.warn('AI Post-meeting sync error:', e);
    }
  }

  return {
    resolvedThreads: [],
    validatedDecisions: [],
    newFacts: [`Meeting minutes synchronized: "${meetingEvent?.title || 'Meeting'}" (${meetingEvent?.date || 'recent'})`],
    newTasks: []
  };
}

window.WorkstreamMemoryEngine = {
  preloadAllWorkstreamMemories,
  loadTopicMemoriesIndex,
  getTopicMemoriesCatalog,
  getMajorTopicMemory,
  saveMajorTopicMemory,
  searchTopicMemories,
  archiveTopicMemory,
  unarchiveTopicMemory,
  deleteTopicMemory,
  synthesizeWorkstreamMemoryWithAI,
  sanitizeTopicMemoryKey,
  loadWorkstreamChat,
  saveWorkstreamChat,
  clearWorkstreamChat,
  getWorkstreamMeetings,
  generateMeetingAgendaWithAI,
  suggestWorkstreamMeetingsWithAI,
  syncPostMeetingWithAI
};

