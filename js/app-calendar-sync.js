/**
 * Secretary Calendar Synchronization Engine (WebCal / iCal & Local OS Calendar Helper)
 * 
 * Supports:
 * 1. Subscribed WebCal / iCal URL Feeds (Google Calendar, Outlook.com/M365, Apple iCloud).
 *    - Automatic protocol scheme normalization (webcal:// -> https://)
 *    - Direct fetch with graceful CORS proxy fallback for browser sandboxes
 *    - RFC 5545 line unfolding, VEVENT parsing, all-day event detection & type inference
 *    - Deduplication against planner-proposals.json and active planner events
 * 2. Local OS Calendar Sync Helper (Corporate Outlook & macOS Calendar)
 *    - Status reporting for planner-proposals.json
 *    - 1-click execution commands & scheduled sync instructions
 */

(function (global) {
  'use strict';

  const MIN_POLL_INTERVAL_MINS = 5;
  const DEFAULT_POLL_INTERVAL_MINS = 15;
  const FETCH_TIMEOUT_MS = 12000;

  const CalendarSyncService = {
    _pollTimer: null,
    _lastSyncTs: 0,
    _isSyncing: false,

    /**
     * Normalize URL schemes (webcal:// and webcals:// to https://)
     * and validate format.
     */
    normalizeCalendarUrl(url) {
      if (!url || typeof url !== 'string') return '';
      let cleaned = url.trim();
      if (/^webcal:\/\//i.test(cleaned)) {
        cleaned = 'https://' + cleaned.slice(9);
      } else if (/^webcals:\/\//i.test(cleaned)) {
        cleaned = 'https://' + cleaned.slice(10);
      }
      return cleaned;
    },

    /**
     * Validate calendar URL structure.
     * Enforces https:// protocol and blocks loopback/local addresses to protect against SSRF.
     */
    isValidCalendarUrl(url) {
      const normalized = this.normalizeCalendarUrl(url);
      try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase();
        if (
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '0.0.0.0' ||
          host === '::1' ||
          host.endsWith('.localhost') ||
          host.endsWith('.local')
        ) {
          return false;
        }
        return true;
      } catch (e) {
        return false;
      }
    },

    /**
     * Sanitize URL for logs or user display by stripping sensitive query parameters and secret tokens.
     */
    sanitizeUrlForLog(url) {
      if (!url || typeof url !== 'string') return '';
      try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      } catch (e) {
        return '[protected-url]';
      }
    },

    /**
     * Retrieve calendar sync configuration from settings.
     */
    getConfig() {
      const s = (typeof settings !== 'undefined' && settings) || {};
      const cs = s.calendarSync || (s.ui && s.ui.calendarSync) || {};
      return {
        enabled: cs.enabled !== false,
        feeds: Array.isArray(cs.feeds) ? cs.feeds : [],
        pollIntervalMinutes: Math.max(MIN_POLL_INTERVAL_MINS, Number(cs.pollIntervalMinutes) || DEFAULT_POLL_INTERVAL_MINS),
        mode: cs.mode || 'proposals' // 'proposals' (default safe review) or 'planner'
      };
    },

    /**
     * Persist calendar sync configuration to settings.
     */
    async saveConfig(config) {
      if (typeof settings === 'undefined' || !settings) return;
      if (!settings.calendarSync) settings.calendarSync = {};
      settings.calendarSync.enabled = config.enabled !== false;
      settings.calendarSync.feeds = Array.isArray(config.feeds) ? config.feeds : [];
      settings.calendarSync.pollIntervalMinutes = Math.max(MIN_POLL_INTERVAL_MINS, Number(config.pollIntervalMinutes) || DEFAULT_POLL_INTERVAL_MINS);
      settings.calendarSync.mode = config.mode || 'proposals';

      if (typeof saveSettings === 'function') {
        await saveSettings();
      }
    },

    /**
     * Fetch raw iCal/ICS content from URL with timeout and CORS fallback.
     */
    async fetchFeedContent(url) {
      const normalizedUrl = this.normalizeCalendarUrl(url);
      if (!this.isValidCalendarUrl(normalizedUrl)) {
        throw new Error('Invalid calendar URL. Please provide a valid webcal:// or https:// link.');
      }

      // Step 1: Attempt direct fetch with AbortSignal timeout
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(normalizedUrl, {
          headers: {
            'Accept': 'text/calendar, text/plain, */*'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const text = await res.text();
          if (text && text.includes('BEGIN:VCALENDAR')) {
            return text;
          }
        }
      } catch (directErr) {
        // Direct fetch failed (e.g. CORS block, network restriction in browser)
        console.warn(`Direct calendar fetch failed for ${this.sanitizeUrlForLog(normalizedUrl)}, trying CORS fallback...`);
      }

      // Step 2: Fallback via CORS gateway proxy (allorigins)
      try {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(normalizedUrl)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const text = await res.text();
          if (text && text.includes('BEGIN:VCALENDAR')) {
            return text;
          }
        }
      } catch (proxyErr) {
        console.warn(`CORS fallback calendar fetch failed for ${this.sanitizeUrlForLog(normalizedUrl)}:`, proxyErr?.message || proxyErr);
      }

      throw new Error('Could not fetch calendar feed. Check URL access permissions or use the local macOS sync helper.');
    },

    /**
     * Parse raw ICS string into structured event objects.
     */
    parseICS(icsText, feedInfo = {}) {
      if (!icsText || typeof icsText !== 'string') return [];

      // RFC 5545 Line unfolding: CRLF/LF followed by space or tab
      const unfolded = icsText.replace(/\r?\n[ \t]/g, '');
      const lines = unfolded.split(/\r?\n/);

      const events = [];
      let inEvent = false;
      let currentProps = {};

      const unescapeICS = (val) => {
        if (!val) return '';
        return val
          .replace(/\\n/gi, '\n')
          .replace(/\\,/g, ',')
          .replace(/\\;/g, ';')
          .replace(/\\\\/g, '\\');
      };

      const parseICSDate = (raw) => {
        if (!raw) return null;
        const clean = raw.trim();
        // Check for all-day date: YYYYMMDD
        const dateMatch = clean.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (dateMatch) {
          return {
            date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
            time: '00:00',
            allDay: true,
            isUtc: false
          };
        }
        // Timestamp: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
        const dtMatch = clean.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?/);
        if (dtMatch) {
          const isUtc = dtMatch[7] === 'Z';
          if (isUtc) {
            const year = parseInt(dtMatch[1], 10);
            const month = parseInt(dtMatch[2], 10) - 1;
            const day = parseInt(dtMatch[3], 10);
            const hours = parseInt(dtMatch[4], 10);
            const minutes = parseInt(dtMatch[5], 10);
            const seconds = parseInt(dtMatch[6] || '0', 10);
            // Convert UTC timestamp into local client date and time
            const utcDate = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
            const localY = utcDate.getFullYear();
            const localM = String(utcDate.getMonth() + 1).padStart(2, '0');
            const localD = String(utcDate.getDate()).padStart(2, '0');
            const localH = String(utcDate.getHours()).padStart(2, '0');
            const localMin = String(utcDate.getMinutes()).padStart(2, '0');
            return {
              date: `${localY}-${localM}-${localD}`,
              time: `${localH}:${localMin}`,
              allDay: false,
              isUtc: true,
              timestamp: utcDate.getTime()
            };
          }

          return {
            date: `${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}`,
            time: `${dtMatch[4]}:${dtMatch[5]}`,
            allDay: false,
            isUtc: false,
            timestamp: new Date(`${dtMatch[1]}-${dtMatch[2]}-${dtMatch[3]}T${dtMatch[4]}:${dtMatch[5]}:00`).getTime()
          };
        }
        return null;
      };

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
            const status = (currentProps['STATUS'] || '').toUpperCase();
            if (status === 'CANCELLED') continue;

            const summary = currentProps['SUMMARY'] || (typeof t === 'function' ? t('planner.importedEvent') : 'Calendar Event');
            const dtStartRaw = currentProps['DTSTART'];
            const dtEndRaw = currentProps['DTEND'];
            const description = currentProps['DESCRIPTION'] || '';
            const location = currentProps['LOCATION'] || '';
            const uid = currentProps['UID'] || '';

            const startParsed = parseICSDate(dtStartRaw);
            if (startParsed) {
              let endParsed = parseICSDate(dtEndRaw);
              let startTime = startParsed.time;
              let endTime = '17:00';
              let duration = 60;

              if (startParsed.allDay) {
                startTime = '00:00';
                endTime = '23:59';
                duration = 1440;
              } else if (endParsed && endParsed.time) {
                endTime = endParsed.time;
                if (startParsed.timestamp && endParsed.timestamp && endParsed.timestamp > startParsed.timestamp) {
                  duration = Math.round((endParsed.timestamp - startParsed.timestamp) / 60000);
                } else if (endParsed.date === startParsed.date && endParsed.time !== startTime) {
                  const [sh, sm] = startTime.split(':').map(Number);
                  const [eh, em] = endTime.split(':').map(Number);
                  const diff = (eh * 60 + em) - (sh * 60 + sm);
                  duration = diff > 0 ? diff : 60;
                } else {
                  duration = 60;
                }
              } else {
                const [sh, sm] = startTime.split(':').map(Number);
                const endMins = (sh * 60 + sm) + 60;
                const eh = String(Math.floor(endMins / 60) % 24).padStart(2, '0');
                const em = String(endMins % 60).padStart(2, '0');
                endTime = `${eh}:${em}`;
                duration = 60;
              }

              // Infer event type using planner helper or keyword heuristic
              const inferType = (typeof inferPlannerEventType === 'function')
                ? inferPlannerEventType(summary, description)
                : this._inferEventType(summary, description);

              const stableHash = this._hashString(`${summary}-${startParsed.date}-${startTime}`);
              const proposalId = uid ? `webcal-${feedInfo.id || 'feed'}-${uid.replace(/[^a-zA-Z0-9_-]/g, '_')}` : `webcal-${feedInfo.id || 'feed'}-${stableHash}`;

              events.push({
                id: proposalId,
                title: summary.slice(0, 300),
                date: startParsed.date,
                startTime,
                endTime,
                duration,
                type: inferType,
                description: description.slice(0, 1000) || (location ? `Location: ${location}` : ''),
                source: feedInfo.name ? `WebCal: ${feedInfo.name}` : 'WebCal Calendar',
                status: 'pending',
                allDay: startParsed.allDay || false
              });
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
            currentProps[keyName] = unescapeICS(valPart);
          }
        }
      }

      return events;
    },

    /**
     * Fallback event type classifier.
     */
    _inferEventType(title, description = '') {
      const combined = `${title} ${description}`.toLowerCase();
      if (/\b(prep|briefing|preparation|vorbereitung)\b/.test(combined)) return 'prep';
      if (/\b(call|meeting|zoom|teams|meet|webex|conference|huddle|1:1|demo|interview)\b/.test(combined)) return 'call';
      if (/\b(sync|standup|daily|retrospective|check-in)\b/.test(combined)) return 'sync';
      if (/\b(todo|task|action item)\b/.test(combined)) return 'todo';
      if (/\b(personal|lunch|gym|doctor|dentist|break|family|coffee|arzt)\b/.test(combined)) return 'personal';
      if (/\b(ooo|out of office|leave|urlaub|conges|holiday)\b/.test(combined)) return 'ooo';
      return 'work';
    },

    _hashString(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash).toString(36);
    },

    /**
     * Test a calendar feed URL and return event count without persisting.
     */
    async testCalendarFeed(url) {
      const text = await this.fetchFeedContent(url);
      const parsed = this.parseICS(text, { name: 'Test Feed' });
      return {
        success: true,
        eventCount: parsed.length,
        events: parsed.slice(0, 5)
      };
    },

    /**
     * Synchronize a specific feed by ID into planner-proposals.json.
     */
    async syncFeed(feedId) {
      const config = this.getConfig();
      const feed = config.feeds.find(f => f.id === feedId);
      if (!feed) throw new Error('Feed not found');

      try {
        const text = await this.fetchFeedContent(feed.url);
        const parsedEvents = this.parseICS(text, feed);

        // Merge proposals into planner-proposals.json
        const mergeResult = await this._mergeIntoProposals(parsedEvents);

        feed.lastSynced = Date.now();
        feed.eventCount = parsedEvents.length;
        feed.lastError = null;
        await this.saveConfig(config);

        return {
          success: true,
          feedName: feed.name,
          totalEvents: parsedEvents.length,
          added: mergeResult.added,
          skipped: mergeResult.skipped
        };
      } catch (err) {
        feed.lastError = err.message || 'Sync failed';
        await this.saveConfig(config);
        throw err;
      }
    },

    /**
     * Synchronize all enabled calendar feeds.
     */
    async syncAllFeeds(force = false) {
      if (this._isSyncing && !force) return null;
      this._isSyncing = true;

      const config = this.getConfig();
      if (!config.enabled || !config.feeds.length) {
        this._isSyncing = false;
        return { success: true, added: 0, skipped: 0, total: 0 };
      }

      let totalAdded = 0;
      let totalSkipped = 0;
      let totalEvents = 0;
      const errors = [];

      try {
        for (const feed of config.feeds) {
          if (!feed.enabled) continue;
          try {
            const res = await this.syncFeed(feed.id);
            totalAdded += res.added;
            totalSkipped += res.skipped;
            totalEvents += res.totalEvents;
          } catch (feedErr) {
            errors.push(`${feed.name}: ${feedErr.message}`);
          }
        }
        this._lastSyncTs = Date.now();
      } finally {
        this._isSyncing = false;
      }

      return {
        success: errors.length === 0,
        added: totalAdded,
        skipped: totalSkipped,
        total: totalEvents,
        errors
      };
    },

    /**
     * Merge parsed events into planner-proposals.json preserving existing entries.
     */
    async _mergeIntoProposals(newEvents) {
      if (!Array.isArray(newEvents) || !newEvents.length) {
        return { added: 0, skipped: 0 };
      }

      let existingProposals = [];
      let rawData = null;

      if (typeof StorageAPI !== 'undefined' && typeof StorageAPI.readPlannerProposals === 'function') {
        try {
          rawData = await StorageAPI.readPlannerProposals();
          if (rawData && Array.isArray(rawData.proposals)) {
            existingProposals = rawData.proposals;
          } else if (Array.isArray(rawData)) {
            existingProposals = rawData;
          }
        } catch (e) {
          console.warn('Could not read planner proposals for sync merge:', e);
        }
      }

      const existingIds = new Set(
        existingProposals.map(p => p && p.id).filter(Boolean)
      );

      // Also check accepted events in plannerEvents to avoid re-proposing accepted meetings
      if (typeof plannerEvents !== 'undefined' && Array.isArray(plannerEvents)) {
        plannerEvents.forEach(e => {
          if (e && e.proposalId) existingIds.add(e.proposalId);
        });
      }

      let added = 0;
      let skipped = 0;

      for (const ev of newEvents) {
        if (existingIds.has(ev.id)) {
          skipped++;
          continue;
        }
        existingProposals.push(ev);
        existingIds.add(ev.id);
        added++;
      }

      if (added > 0 && typeof StorageAPI !== 'undefined' && typeof StorageAPI.writePlannerProposals === 'function') {
        const payload = {
          _notice: (rawData && rawData._notice) || "IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events in this file. Only append new proposals. Secretary tracks processed/accepted proposals by their unique 'id'.",
          version: (rawData && rawData.version) || 1,
          proposals: existingProposals
        };
        await StorageAPI.writePlannerProposals(payload);

        // Reload proposals in Planner if available
        if (typeof loadPlannerProposals === 'function') {
          await loadPlannerProposals();
          if (typeof renderPlanner === 'function') {
            renderPlanner();
          }
        }
      }

      return { added, skipped };
    },

    /**
     * Add a new feed to configuration.
     */
    async addFeed({ name, url, color = '#4f46e5', syncImmediately = true }) {
      const normalized = this.normalizeCalendarUrl(url);
      if (!this.isValidCalendarUrl(normalized)) {
        throw new Error('Invalid calendar URL.');
      }

      const config = this.getConfig();
      const newFeed = {
        id: 'feed-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        name: (name || 'Work Calendar').trim(),
        url: normalized,
        color: color || '#4f46e5',
        enabled: true,
        lastSynced: null,
        eventCount: 0,
        lastError: null
      };

      config.feeds.push(newFeed);
      await this.saveConfig(config);

      // Trigger initial sync if requested
      if (syncImmediately) {
        try {
          await this.syncFeed(newFeed.id);
        } catch (err) {
          console.warn('Initial feed sync encountered warning:', err);
        }
      }

      return newFeed;
    },

    /**
     * Remove a feed by ID.
     */
    async removeFeed(feedId) {
      const config = this.getConfig();
      config.feeds = config.feeds.filter(f => f.id !== feedId);
      await this.saveConfig(config);
    },

    /**
     * Toggle feed enabled status.
     */
    async toggleFeed(feedId, enabled) {
      const config = this.getConfig();
      const feed = config.feeds.find(f => f.id === feedId);
      if (feed) {
        feed.enabled = enabled;
        await this.saveConfig(config);
      }
    },

    /**
     * Starts background auto-sync timer.
     */
    startAutoSync() {
      this.stopAutoSync();
      const config = this.getConfig();
      if (!config.enabled || !config.feeds.length) return;

      const intervalMs = config.pollIntervalMinutes * 60 * 1000;
      this._pollTimer = setInterval(() => {
        this.syncAllFeeds();
      }, intervalMs);

      // Perform initial sync after short delay
      setTimeout(() => {
        this.syncAllFeeds();
      }, 3000);
    },

    /**
     * Stops background auto-sync timer.
     */
    stopAutoSync() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    },

    _externalFolderHandle: null,
    _externalFolderTimer: null,
    _externalLoadedInfo: null,

    /**
     * Generates terminal command to execute zero-dependency local macOS sync script.
     */
    getLocalSyncCommand(workspacePath = '') {
      const wsArg = workspacePath ? ` "${workspacePath}"` : '';
      return `./development/sync_local_calendar.sh${wsArg}`;
    },

    /**
     * Returns full content of the zero-dependency macOS sync shell script.
     */
    getSyncScriptContent() {
      return `#!/usr/bin/env bash
# ==============================================================================
# Secretary Local Calendar Sync Helper (Zero-Dependency macOS Script)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="\$(cd "\$SCRIPT_DIR/.." && pwd)"

if [ -n "$1" ] && [ -d "$1" ]; then
  WORKSPACE_DIR="\$(cd "\$1" && pwd)"
fi

PROPOSALS_FILE="\$WORKSPACE_DIR/planner-proposals.json"

echo "🗓️ Secretary Calendar Sync Helper"
echo "📂 Workspace: \$WORKSPACE_DIR"
echo "📄 Target:    \$PROPOSALS_FILE"

if command -v python3 >/dev/null 2>&1 && [ -f "\$SCRIPT_DIR/sync_local_calendar.py" ]; then
  echo "🚀 Running via python3 sync helper..."
  exec python3 "\$SCRIPT_DIR/sync_local_calendar.py" --workspace "\$WORKSPACE_DIR" "\$@"
fi

echo "⚡ Running via native macOS AppleScript/JXA (zero dependencies required)..."

/usr/bin/osascript -l JavaScript - "\$WORKSPACE_DIR" << 'EOF'
function run(argv) {
  var wsDir = (argv && argv[0]) ? argv[0] : '.';
  var targetPath = wsDir + '/planner-proposals.json';
  
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;

  var existing = {
    "_notice": "IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events in this file. Only append new proposals. Secretary tracks processed/accepted proposals by their unique 'id'.",
    "version": 1,
    "proposals": []
  };

  try {
    var rawExisting = app.read(Path(targetPath));
    if (rawExisting) {
      existing = JSON.parse(rawExisting);
      if (!Array.isArray(existing.proposals)) existing.proposals = [];
    }
  } catch (e) {}

  var existingIds = {};
  for (var i = 0; i < existing.proposals.length; i++) {
    if (existing.proposals[i] && existing.proposals[i].id) {
      existingIds[existing.proposals[i].id] = true;
    }
  }

  var now = new Date();
  var lookahead = new Date();
  lookahead.setDate(now.getDate() + 14);

  var newEvents = [];

  function inferType(title, desc) {
    var c = (title + ' ' + (desc || '')).toLowerCase();
    if (/\\b(prep|briefing|preparation|vorbereitung)\\b/.test(c)) return 'prep';
    if (/\\b(call|meeting|zoom|teams|meet|webex|conference|huddle|1:1|1-on-1|interview|demo|client)\\b/.test(c)) return 'call';
    if (/\\b(sync|standup|daily|retrospective|check-in)\\b/.test(c)) return 'sync';
    if (/\\b(todo|task|action item)\\b/.test(c)) return 'todo';
    if (/\\b(personal|lunch|gym|doctor|dentist|break|vacation|holiday|arzt)\\b/.test(c)) return 'personal';
    if (/\\b(ooo|out of office|leave|urlaub|conges)\\b/.test(c)) return 'ooo';
    return 'work';
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  try {
    var calApp = Application('Calendar');
    if (calApp) {
      var cals = calApp.calendars();
      for (var c = 0; c < cals.length; c++) {
        try {
          var evs = cals[c].events.which({
            _and: [
              { startDate: { _greaterThanEquals: now } },
              { startDate: { _lessThanEquals: lookahead } }
            ]
          })();
          for (var e = 0; e < evs.length; e++) {
            var ev = evs[e];
            var uid = ev.uid();
            var propId = 'apple-cal-' + (uid ? uid.replace(/[^a-zA-Z0-9_-]/g, '_') : Math.random().toString(36).slice(2));
            if (existingIds[propId]) continue;

            var sDate = ev.startDate();
            var eDate = ev.endDate();
            var allDay = ev.alldayEvent();
            var title = ev.summary() || 'Calendar Event';
            var desc = ev.description() || '';

            var y = sDate.getFullYear();
            var m = pad(sDate.getMonth() + 1);
            var d = pad(sDate.getDate());
            var dateStr = y + '-' + m + '-' + d;

            var startTime = allDay ? '00:00' : (pad(sDate.getHours()) + ':' + pad(sDate.getMinutes()));
            var endTime = allDay ? '23:59' : (pad(eDate.getHours()) + ':' + pad(eDate.getMinutes()));
            var duration = allDay ? 1440 : Math.max(15, Math.round((eDate.getTime() - sDate.getTime()) / 60000));

            newEvents.push({
              id: propId,
              title: title.slice(0, 300),
              date: dateStr,
              startTime: startTime,
              endTime: endTime,
              duration: duration,
              type: inferType(title, desc),
              description: desc.slice(0, 1000),
              source: 'Apple Calendar (Local)',
              status: 'pending'
            });
            existingIds[propId] = true;
          }
        } catch(calErr) {}
      }
    }
  } catch(e) {}

  try {
    var outlookApp = Application('Microsoft Outlook');
    if (outlookApp) {
      var oEvents = outlookApp.calendarEvents.which({
        _and: [
          { startTime: { _greaterThanEquals: now } },
          { startTime: { _lessThanEquals: lookahead } }
        ]
      })();
      for (var o = 0; o < oEvents.length; o++) {
        var oEv = oEvents[o];
        var oUid = oEv.id();
        var oPropId = 'outlook-desktop-' + oUid;
        if (existingIds[oPropId]) continue;

        var oStart = oEv.startTime();
        var oEnd = oEv.endTime();
        var oAllDay = oEv.isAllDayEvent();
        var oTitle = oEv.subject() || 'Outlook Meeting';
        var oContent = oEv.plainTextContent() || '';

        var oy = oStart.getFullYear();
        var om = pad(oStart.getMonth() + 1);
        var od = pad(oStart.getDate());
        var oDateStr = oy + '-' + om + '-' + od;

        var oStartTime = oAllDay ? '00:00' : (pad(oStart.getHours()) + ':' + pad(oStart.getMinutes()));
        var oEndTime = oAllDay ? '23:59' : (pad(oEnd.getHours()) + ':' + pad(oEnd.getMinutes()));
        var oDuration = oAllDay ? 1440 : Math.max(15, Math.round((oEnd.getTime() - oStart.getTime()) / 60000));

        newEvents.push({
          id: oPropId,
          title: oTitle.slice(0, 300),
          date: oDateStr,
          startTime: oStartTime,
          endTime: oEndTime,
          duration: oDuration,
          type: inferType(oTitle, oContent),
          description: oContent.slice(0, 1000),
          source: 'Outlook Desktop (Local)',
          status: 'pending'
        });
        existingIds[oPropId] = true;
      }
    }
  } catch(e) {}

  if (newEvents.length > 0) {
    existing.proposals = existing.proposals.concat(newEvents);
    var updatedJson = JSON.stringify(existing, null, 2);
    
    var fileHandle = app.openForAccess(Path(targetPath), { writePermission: true });
    app.setEof(fileHandle, { to: 0 });
    app.write(updatedJson, { to: fileHandle, as: 'utf8' });
    app.closeAccess(fileHandle);
    
    console.log('✓ Successfully synchronized ' + newEvents.length + ' new calendar events into planner-proposals.json');
  } else {
    console.log('✓ Calendar is up to date. No new proposals found.');
  }
}
EOF

echo "✨ Sync complete!"
`;
    },

    /**
     * Downloads sync_local_calendar.sh to user's computer via browser.
     */
    async downloadSyncScript() {
      let content = this.getSyncScriptContent();
      try {
        if (typeof fetch === 'function') {
          const resp = await fetch('development/sync_local_calendar.sh');
          if (resp && resp.ok) {
            content = await resp.text();
          }
        }
      } catch (_e) {}

      const blob = new Blob([content], { type: 'text/x-sh;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sync_local_calendar.sh';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (typeof toast === 'function') {
        toast((typeof t === 'function' ? t('prefs.downloadSyncScriptTooltip') : 'Sync script downloaded'));
      }
    },

    /**
     * Lets user select an input file (.json or .ics) from their computer.
     */
    async selectExternalAgentFile() {
      if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
        try {
          const [fileHandle] = await window.showOpenFilePicker({
            types: [{
              description: 'Calendar & Agent Proposals',
              accept: {
                'application/json': ['.json'],
                'text/calendar': ['.ics']
              }
            }]
          });
          if (fileHandle) {
            const file = await fileHandle.getFile();
            await this.handleExternalFile(file);
          }
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
        }
      }
      const picker = (typeof document !== 'undefined') ? document.getElementById('external-agent-file-picker') : null;
      if (picker) {
        picker.value = '';
        picker.click();
      }
    },

    /**
     * Handles file input change from input element fallback.
     */
    async handleFileInputChange(e) {
      const file = e?.target?.files?.[0];
      if (file) {
        await this.handleExternalFile(file);
      }
    },

    /**
     * Reads and parses external agent proposals or calendar file.
     */
    async handleExternalFile(file) {
      if (!file) return;
      try {
        const text = await file.text();
        const fileName = file.name || 'input-file';
        let items = [];

        if (fileName.endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
          const parsed = JSON.parse(text);
          if (typeof window !== 'undefined' && typeof window.normalizePlannerProposals === 'function') {
            items = window.normalizePlannerProposals(parsed);
          } else if (Array.isArray(parsed)) {
            items = parsed;
          } else if (parsed && Array.isArray(parsed.proposals)) {
            items = parsed.proposals;
          }
        } else if (fileName.endsWith('.ics') || text.includes('BEGIN:VCALENDAR')) {
          items = this.parseICS(text, { name: fileName });
        } else {
          throw new Error('Unsupported format. Please select a .json or .ics file.');
        }

        if (items && items.length > 0) {
          const res = await this._mergeIntoProposals(items);
          this._externalLoadedInfo = { type: 'file', name: fileName, count: items.length };
          this.updateExternalStatusUI();
          if (typeof toast === 'function') {
            const msg = (typeof t === 'function')
              ? t('prefs.externalFileImported', { count: res?.added || items.length, name: fileName })
              : `Imported ${res?.added || items.length} proposals from ${fileName}`;
            toast(msg);
          }
        } else {
          if (typeof toast === 'function') toast('No proposals found in file', true);
        }
      } catch (err) {
        console.error('Failed reading external agent file:', err);
        if (typeof toast === 'function') {
          const msg = (typeof t === 'function')
            ? t('prefs.externalFileError', { error: err.message || 'Parse error' })
            : `Could not read proposals file: ${err.message || ''}`;
          toast(msg, true);
        }
      }
    },

    /**
     * Links local folder (via showDirectoryPicker) where script runs and writes planner-proposals.json.
     */
    async linkExternalAgentFolder() {
      if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
        if (typeof toast === 'function') {
          toast('Folder picker not supported in this browser. Please use "Select File" instead.', true);
        }
        return;
      }

      try {
        const dirHandle = await window.showDirectoryPicker({
          id: 'secretary-external-agent-folder',
          mode: 'read'
        });
        if (!dirHandle) return;

        this._externalFolderHandle = dirHandle;
        await this._syncFromExternalFolderHandle();

        if (this._externalFolderTimer) clearInterval(this._externalFolderTimer);
        this._externalFolderTimer = setInterval(() => {
          this._syncFromExternalFolderHandle().catch(() => {});
        }, 15000);

        this.updateExternalStatusUI();
        if (typeof toast === 'function') {
          const msg = (typeof t === 'function')
            ? t('prefs.externalFolderConnected', { name: dirHandle.name })
            : `Connected folder: ${dirHandle.name}`;
          toast(msg);
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.error('Failed linking external agent folder:', err);
        if (typeof toast === 'function') toast(err.message || 'Could not link folder', true);
      }
    },

    /**
     * Reads planner-proposals.json from linked external folder.
     */
    async _syncFromExternalFolderHandle() {
      if (!this._externalFolderHandle) return;
      try {
        const fileHandle = await this._externalFolderHandle.getFileHandle('planner-proposals.json');
        if (!fileHandle) return;
        const file = await fileHandle.getFile();
        const text = await file.text();
        if (!text) return;

        const parsed = JSON.parse(text);
        const items = (typeof window !== 'undefined' && typeof window.normalizePlannerProposals === 'function')
          ? window.normalizePlannerProposals(parsed)
          : (Array.isArray(parsed) ? parsed : (parsed.proposals || []));

        if (items && items.length > 0) {
          await this._mergeIntoProposals(items);
          this._externalLoadedInfo = { type: 'folder', name: this._externalFolderHandle.name, count: items.length };
          this.updateExternalStatusUI();
        }
      } catch (_e) {}
    },

    /**
     * Disconnects linked external folder.
     */
    disconnectExternalAgentFolder() {
      if (this._externalFolderTimer) {
        clearInterval(this._externalFolderTimer);
        this._externalFolderTimer = null;
      }
      this._externalFolderHandle = null;
      this._externalLoadedInfo = null;
      this.updateExternalStatusUI();
    },

    /**
     * Clears external agent session on user logoff.
     */
    clearExternalAgentSession() {
      if (this._externalFolderTimer) {
        clearInterval(this._externalFolderTimer);
        this._externalFolderTimer = null;
      }
      this._externalFolderHandle = null;
      this._externalLoadedInfo = null;

      const picker = (typeof document !== 'undefined') ? document.getElementById('external-agent-file-picker') : null;
      if (picker) picker.value = '';

      this.updateExternalStatusUI();
    },

    /**
     * Updates UI badge and indicator for linked folder / loaded file.
     */
    updateExternalStatusUI() {
      if (typeof document === 'undefined') return;
      const statusEl = document.getElementById('prefs-local-proposals-status');
      const linkedBox = document.getElementById('prefs-external-agent-linked-box');
      const linkedLabel = document.getElementById('prefs-external-agent-linked-label');

      if (this._externalFolderHandle) {
        if (linkedBox) linkedBox.style.display = 'flex';
        if (linkedLabel) linkedLabel.textContent = `📁 ${this._externalFolderHandle.name} (${this._externalLoadedInfo?.count || 0})`;
        if (statusEl) {
          const count = this._externalLoadedInfo?.count || 0;
          statusEl.textContent = (typeof t === 'function') ? t('prefs.externalActiveBadge', { count }) : `${count} active`;
          statusEl.style.background = 'var(--accent)';
          statusEl.style.color = '#fff';
        }
      } else if (this._externalLoadedInfo) {
        if (linkedBox) linkedBox.style.display = 'flex';
        if (linkedLabel) linkedLabel.textContent = `📄 ${this._externalLoadedInfo.name} (${this._externalLoadedInfo.count})`;
        if (statusEl) {
          const count = this._externalLoadedInfo.count;
          statusEl.textContent = (typeof t === 'function') ? t('prefs.externalImportedBadge', { count }) : `${count} imported`;
          statusEl.style.background = 'var(--accent)';
          statusEl.style.color = '#fff';
        }
      } else {
        if (linkedBox) linkedBox.style.display = 'none';
        if (statusEl) {
          statusEl.textContent = (typeof t === 'function') ? t('prefs.externalZeroProposals') : '0 proposals';
          statusEl.style.background = 'var(--bg-tag)';
          statusEl.style.color = 'var(--text-muted)';
        }
      }
    },

    /**
     * Initialize service on application start.
     */
    init() {
      this.startAutoSync();
    }
  };

  // Expose globally
  if (typeof window !== 'undefined') {
    window.CalendarSyncService = CalendarSyncService;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.CalendarSyncService = CalendarSyncService;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
