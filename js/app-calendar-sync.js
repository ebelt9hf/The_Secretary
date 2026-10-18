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

    /**
     * Generates terminal command to execute zero-dependency local macOS sync script.
     */
    getLocalSyncCommand(workspacePath = '') {
      const wsArg = workspacePath ? ` "${workspacePath}"` : '';
      return `./development/sync_local_calendar.sh${wsArg}`;
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
