#!/usr/bin/env python3
"""
Secretary Local Calendar Sync Helper
Extracts upcoming calendar events from local macOS applications (Microsoft Outlook and Apple Calendar)
and writes them as proposals into Secretary's planner-proposals.json.

Zero cloud access required. Respects enterprise IT boundaries by running purely on your local machine.
"""

import sys
import os
import json
import subprocess
import argparse
import hashlib
from datetime import datetime, timedelta

DEFAULT_LOOKAHEAD_DAYS = 14
MAX_EVENT_TITLE_LEN = 300
MAX_EVENT_DESC_LEN = 1000

def get_workspace_path(cli_path=None):
    if cli_path and os.path.isdir(cli_path):
        return os.path.abspath(cli_path)
    # Default to parent directory of the script if located in development/
    script_dir = os.path.dirname(os.path.abspath(__file__))
    parent_dir = os.path.abspath(os.path.join(script_dir, ".."))
    if os.path.exists(os.path.join(parent_dir, "app.html")):
        return parent_dir
    return os.getcwd()

def infer_event_type(title, description=""):
    combined = f"{title} {description}".lower()
    if any(k in combined for k in ["prep", "briefing", "preparation", "vorbereitung"]):
        return "prep"
    if any(k in combined for k in ["sync", "standup", "daily", "retrospective", "check-in"]):
        return "sync"
    if any(k in combined for k in ["call", "meeting", "zoom", "teams", "meet", "webex", "conference", "huddle", "1:1", "1-on-1", "interview", "demo", "client"]):
        return "call"
    if any(k in combined for k in ["todo", "task", "action item"]):
        return "todo"
    if any(k in combined for k in ["personal", "lunch", "gym", "doctor", "dentist", "break", "vacation", "holiday", "arzt"]):
        return "personal"
    if any(k in combined for k in ["ooo", "out of office", "leave", "urlaub", "conges"]):
        return "ooo"
    return "work"

def run_applescript(script):
    try:
        proc = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=15
        )
        if proc.returncode == 0:
            return proc.stdout.strip()
        return None
    except Exception as e:
        return None

def fetch_apple_calendar_events(start_dt, end_dt):
    """Fetch events from macOS Calendar.app via AppleScript."""
    start_str = start_dt.strftime("%B %d, %Y 00:00:00")
    end_str = end_dt.strftime("%B %d, %Y 23:59:59")

    as_script = f'''
    set output to ""
    set startDate to date "{start_str}"
    set endDate to date "{end_str}"
    tell application "Calendar"
        repeat with c in calendars
            try
                set evs to (every event of c whose (start date >= startDate and start date <= endDate))
                repeat with e in evs
                    set evTitle to summary of e
                    set evStart to start date of e as «class isot» as string
                    set evEnd to end date of e as «class isot» as string
                    set evAllDay to allday event of e
                    set evLoc to location of e
                    if evLoc is missing value then set evLoc to ""
                    set evDesc to description of e
                    if evDesc is missing value then set evDesc to ""
                    set evUid to uid of e
                    set output to output & evTitle & "|||" & evStart & "|||" & evEnd & "|||" & (evAllDay as string) & "|||" & evLoc & "|||" & evDesc & "|||" & evUid & "\\n"
                end repeat
            end try
        end repeat
    end tell
    return output
    '''
    raw = run_applescript(as_script)
    if not raw:
        return []

    events = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line or "|||" not in line:
            continue
        parts = line.split("|||")
        if len(parts) < 4:
            continue

        title = parts[0].strip() or "Calendar Event"
        start_iso = parts[1].strip()
        end_iso = parts[2].strip()
        all_day_str = parts[3].strip().lower()
        location = parts[4].strip() if len(parts) > 4 else ""
        desc = parts[5].strip() if len(parts) > 5 else ""
        uid = parts[6].strip() if len(parts) > 6 else ""

        is_all_day = all_day_str in ["true", "yes", "1"]

        try:
            start_clean = start_iso.replace("Z", "").split(".")[0]
            dt = datetime.fromisoformat(start_clean)
            date_str = dt.strftime("%Y-%m-%d")
            start_time = "00:00" if is_all_day else dt.strftime("%H:%M")

            duration = 60
            if end_iso and not is_all_day:
                try:
                    end_clean = end_iso.replace("Z", "").split(".")[0]
                    dt_end = datetime.fromisoformat(end_clean)
                    duration = max(15, int((dt_end - dt).total_seconds() / 60))
                    end_time = dt_end.strftime("%H:%M")
                except Exception:
                    end_time = (dt + timedelta(minutes=duration)).strftime("%H:%M")
            elif is_all_day:
                duration = 1440
                end_time = "23:59"
            else:
                end_time = (dt + timedelta(minutes=duration)).strftime("%H:%M")

            ev_id = f"local-apple-{uid}" if uid else f"local-apple-{hashlib.sha256((title + date_str + start_time).encode()).hexdigest()[:16]}"
            events.append({
                "id": ev_id,
                "title": title[:MAX_EVENT_TITLE_LEN],
                "date": date_str,
                "startTime": start_time,
                "endTime": end_time,
                "duration": duration,
                "type": infer_event_type(title, desc),
                "description": desc[:MAX_EVENT_DESC_LEN] if desc else (f"Location: {location}" if location else ""),
                "source": "Local: Apple Calendar",
                "status": "pending"
            })
        except Exception:
            continue

    return events

def fetch_outlook_events(start_dt, end_dt):
    """Fetch events from Microsoft Outlook for Mac via AppleScript."""
    start_str = start_dt.strftime("%B %d, %Y 00:00:00")
    end_str = end_dt.strftime("%B %d, %Y 23:59:59")

    as_script = f'''
    set output to ""
    set startDate to date "{start_str}"
    set endDate to date "{end_str}"
    tell application "Microsoft Outlook"
        try
            set evs to (every calendar event whose (start time >= startDate and start time <= endDate))
            repeat with e in evs
                set evTitle to subject of e
                set evStart to start time of e as «class isot» as string
                set evEnd to end time of e as «class isot» as string
                set evAllDay to all day event of e
                set evLoc to location of e
                if evLoc is missing value then set evLoc to ""
                set evDesc to plain text content of e
                if evDesc is missing value then set evDesc to ""
                set evId to id of e
                set output to output & evTitle & "|||" & evStart & "|||" & evEnd & "|||" & (evAllDay as string) & "|||" & evLoc & "|||" & evDesc & "|||" & (evId as string) & "\\n"
            end repeat
        end try
    end tell
    return output
    '''
    raw = run_applescript(as_script)
    if not raw:
        return []

    events = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line or "|||" not in line:
            continue
        parts = line.split("|||")
        if len(parts) < 4:
            continue

        title = parts[0].strip() or "Outlook Meeting"
        start_iso = parts[1].strip()
        end_iso = parts[2].strip()
        all_day_str = parts[3].strip().lower()
        location = parts[4].strip() if len(parts) > 4 else ""
        desc = parts[5].strip() if len(parts) > 5 else ""
        raw_id = parts[6].strip() if len(parts) > 6 else ""

        is_all_day = all_day_str in ["true", "yes", "1"]

        try:
            start_clean = start_iso.replace("Z", "").split(".")[0]
            dt = datetime.fromisoformat(start_clean)
            date_str = dt.strftime("%Y-%m-%d")
            start_time = "00:00" if is_all_day else dt.strftime("%H:%M")

            duration = 60
            if end_iso and not is_all_day:
                try:
                    end_clean = end_iso.replace("Z", "").split(".")[0]
                    dt_end = datetime.fromisoformat(end_clean)
                    duration = max(15, int((dt_end - dt).total_seconds() / 60))
                    end_time = dt_end.strftime("%H:%M")
                except Exception:
                    end_time = (dt + timedelta(minutes=duration)).strftime("%H:%M")
            elif is_all_day:
                duration = 1440
                end_time = "23:59"
            else:
                end_time = (dt + timedelta(minutes=duration)).strftime("%H:%M")

            ev_id = f"local-outlook-{raw_id}" if raw_id else f"local-outlook-{hashlib.sha256((title + date_str + start_time).encode()).hexdigest()[:16]}"
            events.append({
                "id": ev_id,
                "title": title[:MAX_EVENT_TITLE_LEN],
                "date": date_str,
                "startTime": start_time,
                "endTime": end_time,
                "duration": duration,
                "type": infer_event_type(title, desc),
                "description": desc[:MAX_EVENT_DESC_LEN] if desc else (f"Location: {location}" if location else ""),
                "source": "Local: Microsoft Outlook",
                "status": "pending"
            })
        except Exception:
            continue

    return events

def merge_proposals(workspace_dir, new_proposals, dry_run=False):
    proposals_file = os.path.join(workspace_dir, "planner-proposals.json")

    existing_data = {
        "_notice": "IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events in this file. Only append new proposals. Secretary tracks processed/accepted proposals by their unique 'id'.",
        "version": 1,
        "proposals": []
    }

    if os.path.exists(proposals_file):
        try:
            with open(proposals_file, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict) and "proposals" in loaded and isinstance(loaded["proposals"], list):
                    existing_data = loaded
        except Exception as e:
            print(f"[Warning] Could not read existing proposals file: {e}")

    existing_ids = {p.get("id") for p in existing_data["proposals"] if isinstance(p, dict) and "id" in p}
    
    # Also check planner.json to prevent proposing events that are already accepted
    planner_file = os.path.join(workspace_dir, "planner.json")
    if os.path.exists(planner_file):
        try:
            with open(planner_file, "r", encoding="utf-8") as f:
                p_data = json.load(f)
                events = p_data.get("events", []) if isinstance(p_data, dict) else []
                for ev in events:
                    if isinstance(ev, dict) and "proposalId" in ev:
                        existing_ids.add(ev["proposalId"])
        except Exception:
            pass

    added_count = 0
    skipped_count = 0

    for prop in new_proposals:
        prop_id = prop.get("id")
        if prop_id in existing_ids:
            skipped_count += 1
            continue
        existing_data["proposals"].append(prop)
        existing_ids.add(prop_id)
        added_count += 1

    if dry_run:
        print(f"[Dry Run] Found {len(new_proposals)} events: {added_count} would be added, {skipped_count} skipped as duplicates.")
        return added_count, skipped_count

    if added_count > 0 or not os.path.exists(proposals_file):
        with open(proposals_file, "w", encoding="utf-8") as f:
            json.dump(existing_data, f, indent=2, ensure_ascii=False)
        print(f"✅ Successfully updated {proposals_file}: {added_count} new proposal(s) added ({skipped_count} duplicate(s) skipped).")
    else:
        print(f"ℹ️ No new events to add ({skipped_count} duplicate(s) already in proposals or planner).")

    return added_count, skipped_count

def main():
    parser = argparse.ArgumentParser(description="Secretary Local Calendar Sync Helper (macOS Outlook & Apple Calendar)")
    parser.add_argument("--workspace", help="Path to Secretary workspace folder (contains planner-proposals.json)")
    parser.add_argument("--days", type=int, default=DEFAULT_LOOKAHEAD_DAYS, help="Number of days to sync ahead (default: 14)")
    parser.add_argument("--source", choices=["all", "outlook", "apple"], default="all", help="Calendar source to inspect")
    parser.add_argument("--dry-run", action="store_true", help="Inspect calendar events without writing to planner-proposals.json")
    args = parser.parse_args()

    if sys.platform != "darwin":
        print("⚠️ Local AppleScript calendar extraction is currently only supported on macOS.")
        print("For Windows/Linux or web accounts, please use the WebCal/iCal URL feed subscription in Secretary Settings.")
        sys.exit(1)

    ws_dir = get_workspace_path(args.workspace)
    print(f"🗓️ Secretary Local Calendar Sync Helper")
    print(f"📁 Workspace: {ws_dir}")

    now = datetime.now()
    start_dt = now - timedelta(days=1)
    end_dt = now + timedelta(days=args.days)
    print(f"🔍 Looking up events from {start_dt.strftime('%Y-%m-%d')} to {end_dt.strftime('%Y-%m-%d')}...")

    extracted = []
    if args.source in ["all", "outlook"]:
        outlook_events = fetch_outlook_events(start_dt, end_dt)
        print(f"  • Microsoft Outlook: {len(outlook_events)} event(s) found.")
        extracted.extend(outlook_events)

    if args.source in ["all", "apple"]:
        apple_events = fetch_apple_calendar_events(start_dt, end_dt)
        print(f"  • Apple Calendar: {len(apple_events)} event(s) found.")
        extracted.extend(apple_events)

    merge_proposals(ws_dir, extracted, dry_run=args.dry_run)

if __name__ == "__main__":
    main()
