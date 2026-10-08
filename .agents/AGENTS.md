# Agent Guidelines for Secretary Repository

Welcome! When working on the **Secretary** project, follow these mandatory guidelines for internationalization, verification, and code quality.

---

## 1. Internationalization & Translation Workflow

Secretary supports **15 European languages**: English (`en`), Deutsch (`de`), Français (`fr`), Čeština (`cs`), Español (`es`), Magyar (`hu`), Italiano (`it`), Nederlands (`nl`), Polski (`pl`), Português (`pt`), Română (`ro`), Русский (`ru`), Svenska (`sv`), Türkçe (`tr`), and Українська (`uk`).

### Workflow when adding or editing UI strings:
1. All translations are stored in **one single canonical file**: `js/translations.js`.
2. Open `js/translations.js` and add/update your key(s) under `"translations"` with strings for all 15 languages in a single edit.
3. Run the validation tool to ensure 100% key parity and no missing strings:
   ```bash
   python3 development/check_translations.py
   ```

---

## 2. Hover Tooltip & UI Guidelines

- **Hover Tooltips Required**: All interactive elements (buttons, links, inputs) MUST have a localized `title` attribute describing the outcome of the action (e.g. `element.title != element.textContent`).
- **No Hardcoded Strings**: All UI text must use `t('key')` helper function.
- **No Icons/Emojis in Translation Strings**: Translation strings in `js/translations.js` MUST contain clean plain text only — never embed emojis or icons inside translation strings. Icons must always be rendered as layout/SVG elements adapted to the UI.
- **Cache Busting & Versioning**: If updating HTML/CSS/JS files, update cache-buster query strings `?v=X.X.X` in `app.html`.

---

## 3. Versioning Guidelines

- **Version Number Increments on `main`**: Version numbers, cache-buster query strings (`?v=X.X.X`), and release links MUST be increased with each commit to the `main` branch.
  - Default increment: Patch version (`--patch`) for bug fixes, tweaks, and regular commits.
  - Minor version (`--minor`) or Major version (`--major`) when introducing significant features, new architecture, or breaking changes.
- **Workflow When Committing to `main`**:
  - Run the automated version synchronizer to bump version across `package.json`, `package-lock.json`, `app.html` (`connect-version-hint` and cache busters), `note-window.html`, `secretary-window.html`, and `README.md`:
    ```bash
    python3 development/bump_version.py <new_version|--patch|--minor|--major>
    ```
  - Verify version parity using:
    ```bash
    python3 development/bump_version.py --check
    ```
  - A pre-commit Git hook (`.githooks/pre-commit`) is also installed to automatically bump and stage the patch version if committing directly to `main` without an existing version bump.

---

## 4. Unit Testing & Test-Driven Bug Fixing Guidelines

- **Unit Test Coverage**: All new features, parameter schemas, and core engine methods MUST be covered with unit tests under `tests/unit/`.
- **Test-Driven Bug Fixing**: Whenever addressing a bug, regression, or edge case:
  1. **Design a Reproducing Unit Test**: Create or update a unit test in `tests/unit/` that specifically reproduces the bug and catches the failure.
  2. **Verify Failure**: Run `npm test` to confirm the new unit test fails as expected.
  3. **Fix the Bug**: Update the codebase logic until all tests pass cleanly.

---

## 5. Pre-Commit / Verification Commands

Always run the following commands before completing any task:
```bash
python3 development/check_translations.py
npm test
npm run build
```

---

## 6. Proposing Planner Events via `planner-proposals.json`

External AI agents or background processes on the user's computer can propose calendar blocks:
- **File Location**: `./planner-proposals.json` (located at the root workspace directory). Secretary automatically ensures this file is always created and maintained.
- **Append-Only Rule**: External agents must **never** delete existing entries from `planner-proposals.json`; only append new proposals.
- **Unique ID**: Every proposal **must** include a unique `id` (e.g. `"agent-task-001"`). Secretary uses this `id` to avoid duplicates and track accepted/reviewed entries.
- **Schema**:
  ```json
  {
    "_notice": "IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events in this file. Only append new proposals. Secretary tracks processed/accepted proposals by their unique 'id'.",
    "version": 1,
    "proposals": [
      {
        "id": "agent-proposal-12345",
        "title": "Code Review Session",
        "date": "2026-09-16",
        "startTime": "10:00",
        "endTime": "11:00",
        "duration": 60,
        "type": "work",
        "description": "Proposed by Agent: Review PR #42",
        "source": "Agent",
        "status": "pending"
      }
    ]
  }
  ```
- **Supported Event Types (`type`)**: `type` is required and must be one of the following 8 supported event types:
  - `"call"`: Voice or video call (e.g. client calls, Zoom / Google Meet conferences, external phone conversations). Supports linking collaborators and notes.
  - `"sync"`: Team synchronization or 1-on-1 meeting (e.g. daily standups, weekly 1:1 check-ins, sprint planning, team alignment). Supports linking collaborators and notes.
  - `"prep"`: Meeting preparation or follow-up buffer block (e.g. preparing presentation slides, reviewing agendas, post-meeting debriefs). Associated with an existing call/meeting.
  - `"work"`: Deep work / focused execution block (e.g. project work, software engineering, writing, research, analysis, strategy). Supports linking project tags, workstreams, and notes.
  - `"todo"`: Scheduled work session specifically dedicated to working on and completing a task from the Todo list.
  - `"personal"`: Personal event, break, or private appointment (e.g. lunch break, doctor / medical appointment, workout, private errands, admin tasks). Does not require notes or project tags.
  - `"ooo"`: Out of Office / leave / travel / holiday (e.g. vacation, public holiday, business trip travel, day off). Spans unavailable time, automatically hiding project tags and notes.
  - `"custom"`: Generic or flexible custom event block.
- **Duration & Full-Day Support**: `duration` is optional and supports flexible input formats:
  - Integer or decimal minutes (e.g. `45`, `60`, `90`).
  - Unit strings (e.g. `"45m"`, `"1.5h"`, `"2 hrs"`, `"1h 30m"`, `"01:30"`, `"PT1H30M"`).
  - All-day / Full-day variance: A full day is 1440 minutes. Secretary supports `1440`, `1439` (for 23:59 minute variance), `"1440"`, `"1439"`, `"1d"`, `"all-day"`, `"full day"`.
  - If `endTime` is omitted, Secretary automatically computes `endTime = startTime + duration`.
- **UI Autodetection**: Secretary automatically detects additions to `planner-proposals.json`, shows a flashing indicator in the planner header, and renders them as dashed blocks when proposal review mode is active.

