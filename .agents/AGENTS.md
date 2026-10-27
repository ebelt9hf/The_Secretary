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

- **Coverage Mandate**: All new features, parameter schemas, and core engine methods MUST be covered with unit tests under `tests/unit/`.
- **Test-Driven Bug Fixing Workflow**: Whenever addressing a bug, regression, or edge case:
  1. **Design a Reproducing Unit Test**: Create or update a unit test in `tests/unit/` that specifically reproduces the bug and catches the failure.
  2. **Verify Failure**: Run `npm test` to confirm the new unit test fails as expected.
  3. **Fix the Bug**: Update the codebase logic until all tests pass cleanly.
  4. **Perform 4-Point Audit**: Verify the test meets the quality and isolation criteria below.

- **Mandatory 4-Point Unit Test Review & Audit Checklist**:
  Every unit test (new or existing) must be verified and documented against these four core principles:
  1. **Protected Behavior**:
     - *Question*: What specific invariant, contract, or behavior does this test protect?
     - *Standard*: State the exact functional behavior and condition being asserted. Test titles (`it(...)` / `test(...)`) must explicitly describe the expected outcome and condition (avoid vague titles like `"works"` or `"handles errors"`).
  2. **Regression Target**:
     - *Question*: What exact code failure or regression would cause this test to fail?
     - *Standard*: Assertions must be tight and specific (`toBe()`, `toEqual()`, `toHaveBeenCalledWith()`, or specific error messages) rather than loose truthiness checks (`toBeTruthy()`).
  3. **Coverage Overlap & Redundancy**:
     - *Question*: Is this failure mode already covered by an existing test?
     - *Standard*: Avoid duplicate tests exercising identical execution branches. Multi-layer tests are only permitted when intentionally validating architectural boundaries (e.g. UI-layer sanitization vs. storage-layer defense-in-depth, or main thread vs. Web Worker thread execution).
  4. **Production Code Footprint**:
     - *Question*: Does this test require production code that exists only to support testing?
     - *Standard*: Production code must **NEVER** contain helper functions, test flags, dummy properties, or bypasses introduced solely to accommodate tests. Tests must exercise authentic production contracts and public module interfaces. Use Vitest mocks/spies (`vi.spyOn`, `vi.fn`) or test fixtures under `tests/helpers/` for test isolation.

- **Test Hygiene & Isolation Rules**:
  - Always clean up in `beforeEach` / `afterEach` by resetting shared state, clearing caches, and restoring mocks (`vi.restoreAllMocks()`).
  - Never allow tests to mutate shared globals without guaranteed restoration in `afterEach`.
  - Never perform unmocked network or native filesystem calls in unit tests.

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
        "timezone": "America/New_York",
        "duration": 60,
        "type": "work",
        "description": "Proposed by Agent: Review PR #42",
        "source": "Agent",
        "status": "pending"
      }
    ]
  }
  ```
- **Timezone Support (`timezone`)**: Strongly recommended for meeting invitations and scheduled events.
  - Supports standard IANA time zone identifiers (e.g. `"America/New_York"`, `"Europe/Paris"`, `"Europe/London"`, `"Asia/Tokyo"`, `"UTC"`) or UTC offsets (e.g. `"+02:00"`, `"-05:00"`).
  - External agents should extract the invitation's timezone and specify it here (or provide ISO 8601 strings with timezone/offset in `startTime` or `startDateTime`, e.g. `"14:00Z"`, `"2026-09-16T10:00:00-05:00"`).
  - Secretary automatically converts the proposed event's date and times into the user's local system timezone upon import, ensuring calendar blocks appear at the exact correct local time.
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

