#!/usr/bin/env bash
# ==============================================================================
# Secretary Local Calendar Sync Helper (Zero-Dependency macOS Script)
# ==============================================================================
# Extracts upcoming calendar events from local macOS applications (Microsoft
# Outlook and Apple Calendar) into Secretary's planner-proposals.json.
#
# Runs natively on 100% of Macs out-of-the-box using built-in macOS tools.
# If python3 is installed, uses python3 development/sync_local_calendar.py.
# Otherwise, executes via macOS native osascript (JXA / JavaScript for Automation).
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check if a custom workspace directory was passed as argument
if [ -n "$1" ] && [ -d "$1" ]; then
  WORKSPACE_DIR="$(cd "$1" && pwd)"
fi

PROPOSALS_FILE="$WORKSPACE_DIR/planner-proposals.json"

echo "🗓️ Secretary Calendar Sync Helper"
echo "📂 Workspace: $WORKSPACE_DIR"
echo "📄 Target:    $PROPOSALS_FILE"

# Preference 1: If python3 is available on the machine, run sync_local_calendar.py
if command -v python3 >/dev/null 2>&1; then
  echo "🚀 Running via python3 sync helper..."
  exec python3 "$SCRIPT_DIR/sync_local_calendar.py" --workspace "$WORKSPACE_DIR" "$@"
fi

# Preference 2: Zero-dependency fallback using native macOS osascript (JavaScript for Automation)
echo "⚡ Running via native macOS AppleScript/JXA (zero dependencies required)..."

/usr/bin/osascript -l JavaScript - "$WORKSPACE_DIR" << 'EOF'
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
  } catch (e) {
    // File does not exist yet, will be created
  }

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

  // Helper to infer event type
  function inferType(title, desc) {
    var c = (title + ' ' + (desc || '')).toLowerCase();
    if (/\b(prep|briefing|preparation|vorbereitung)\b/.test(c)) return 'prep';
    if (/\b(call|meeting|zoom|teams|meet|webex|conference|huddle|1:1|1-on-1|interview|demo|client)\b/.test(c)) return 'call';
    if (/\b(sync|standup|daily|retrospective|check-in)\b/.test(c)) return 'sync';
    if (/\b(todo|task|action item)\b/.test(c)) return 'todo';
    if (/\b(personal|lunch|gym|doctor|dentist|break|vacation|holiday|arzt)\b/.test(c)) return 'personal';
    if (/\b(ooo|out of office|leave|urlaub|conges)\b/.test(c)) return 'ooo';
    return 'work';
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 1. Check Apple Calendar
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

  // 2. Check Microsoft Outlook Desktop (if available)
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
    
    // Write file back to disk
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
