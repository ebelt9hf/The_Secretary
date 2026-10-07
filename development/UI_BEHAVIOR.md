# Secretary App — UI Behavior Reference

> **Single source of truth** for the intended look and behavior of the Secretary browser app.
> Keep this file in sync with every UI change.

---

## 1. Overview

**Secretary** is a browser-only note and task manager that reads and writes directly to a local disk folder using the **File System Access API** (Chrome / Edge only — no backend, no server).

**Technology stack:**
- Vanilla JavaScript (ES2020, `'use strict'`), split across `js/app-*.js` modules
- HTML: `app.html` (single-page, ~420 lines)
- CSS: `css/app-base.css`, `app-board.css`, `app-editor.css`, `app-focus.css`, `app-todos.css`, `app-misc.css`
- Libraries: `marked.js` (Markdown → HTML), `turndown.js` (HTML → Markdown)

**Language support:**
- UI strings are localized through `js/app-i18n.js`
- The Preferences language selector currently supports English, German, and French
- French is the default language for first-time use
- The chosen language is persisted in settings and applied immediately across the app
- Local settings are saved in browser storage so preferences survive a restart

**How it loads:**
1. User is shown the **landing screen** (`#screen-connect`).
2. If a previously-used folder handle is cached in IndexedDB, Secretary first tries to reopen it automatically.
3. While Secretary is checking or mounting a remembered folder, the landing actions stay hidden and a short loading hint is shown so the user cannot start a second open flow mid-load.
4. If the browser still needs authorization, a **"↩ Resume last folder"** button appears; clicking it re-requests access and, if the picker is needed, starts from the remembered folder.
5. User clicks **"📂 Open Secretary Folder"** to choose a folder manually, with the picker also seeded to the last used folder when available.
6. On grant, `mountFolder()` reads `notes_summary.json` (note manifest) and the `todos/` folder, then switches to **`#screen-main`**.

---

## 2. Navigation & Tabs

### Top Bar Layout — two rows

**Row 1 (always visible):**

| Element | Description |
|---|---|
| `📓 Secretary` | App logo/title, non-clickable |
| `📝 Notes` tab | Activates Notes mode (swimlane board); active = highlighted |
| `📋` Todos tab | Activates Todos mode (priority board); active = highlighted |
| Spacer (flex) | Pushes search group to right |
| Search input | 180px text field; searches notes live on every keystroke |
| `C` toggle | **Content search** — when ON (default), also searches note body text, not just title/tags |
| `aa` toggle | **Case sensitive** — when ON, search is case-sensitive |
| `.*` toggle | **Regex** — when ON, treats search as a regular expression |
| `⚙` icon | Opens Preferences panel; lights up white when active |

All search toggle buttons use class `.on` to indicate active state (brighter background).

**Row 2 (context sub-row, hidden in Preferences mode):**

*In Notes mode:*

| Element | Description |
|---|---|
| **Axis pills** `[Groups] [Topics] [Weeks]` | Sets `laneAxis`; active pill has white fill + navy text |
| **by: [Day ▾]** selector | Visible only when axis = Weeks; selects sub-grouping within each week lane (`day`/`group`/`major`/`topic`) |
| Spacer | |
| `📋` (todo lane) | Toggles a pinned "open todos" lane at the top of the notes board |
| `⚙ Filter` | Slides the filter bar open/closed below the top bar |
| Active filter chip | Dark navy pill showing the current major/topic filter; click to clear |
| Folder name | Dimmed small text showing the open folder name |

*In Todos mode:*

| Element | Description |
|---|---|
| `Show Done` btn | Toggles display of Done lane |
| `🗑 Clear Done` btn | Deletes all done todos after confirmation |
| Spacer | |
| Folder name | Dimmed small text showing the open folder name |

### Tabs Behavior

- **Notes tab**: `boardMode = 'notes'`; renders swimlane board. Left sidebar visible. Sub-row shows axis pills.
- **Todos tab**: `boardMode = 'todos'`; renders priority board. Left sidebar visible. Sub-row shows Show Done / Clear Done.
- **Preferences** (⚙ icon, top-right of row 1): hides the swimlane board; shows `#prefs-panel`. Left sidebar hidden. Sub-row hidden.
- Switching tabs does NOT close open overlays.

### Filter Bar

Slides down below the top bar when `⚙ Filter` is clicked.

- Contains two rows: **Major Topic** chips and **Topic** chips.
- Chips follow the same ordering rules as the board lanes (recent-first when lane sorting is "Newest first", alphabetical when lane sorting is "Alphabetical").
- Clicking a chip sets `activeFilter` (major or topic); active chip gets outline highlight.
- A red `✕ Clear` button appears when a filter is active.
- The currently active major/topic filter also shows as an **active filter chip** in the sub-row (right of the filter button), clickable to clear.

### Lane Axis Pills

Three pills in the Notes sub-row: **Groups**, **Topics**, **Weeks**. Clicking a pill calls `setLaneAxis(axis)`.

- State persisted in `localStorage` as `secretaryLaneAxis`
- When axis = **Groups**: lanes represent group tags; left sidebar shows group names
- When axis = **Major Topics**: lanes represent major topic tags; left sidebar shows major topic names
- When axis = **Weeks**: lanes represent ISO calendar weeks; see Section 4 — Week Axis for full details

---

## 3. Left Group Nav Sidebar

Visible only in Notes mode (not Todos, not Preferences).

**Three states** (cycled by clicking the `‹` / `«` / `›` toggle button):
| State | Width | Shows |
|---|---|---|
| `full` | 200 px | Colored swatch + full name |
| `compact` | 58 px | Colored swatch + 3-letter abbreviation only |
| `hidden` | 26 px | Toggle button only; item list hidden |

State is persisted in `localStorage`. On narrow screens (< 1200 px), it auto-collapses via `ResizeObserver`.

**Each nav item:**
- Shows a colored square swatch (background = topic hue, lighter) + name + note count badge
- Color derived deterministically from the tag name via `colorForGroup(name)` (HSL hash)
- Single-clicking smoothly scrolls to that lane on the board with a visual highlight pulse (without hiding other lanes)
- Double-clicking isolates/filters the board to only that group/topic (double-clicking again resets filter)
- Active item becomes a segmented pill; the edit pencil shares the highlight on the right

### Label editing

- Single-click scrolls to the matching lane in the board; double-click isolates the lane filter
- Hover a label row to reveal an integrated pencil segment on the right; the row and pencil share the same highlight pill
- Hovering a label row lightly highlights the matching lane in the board
- Right-click the row opens a context menu with an **Edit ...** action
- Selecting **Edit** from that menu opens the **Label Manager**
- Group/Major lane headers also include an edit button (✎) and the same context-menu path
- The Label Manager supports **rename**, **merge**, **promote**, **split**, and **remove** operations across all matching notes
- Target fields in the Label Manager open an editor-style suggestion popup; click a chip to fill the active field, or type a new label if needed
- Week lanes do not expose label editing because they are date-derived lanes, not label-derived lanes

**Header Controls:**
- Title at top of sidebar updates: "Groups", "Topics", or "Weeks" matching current lane axis with total items badge
- Sort mode toggle button (⏱ Recent Activity vs 🔤 Alphabetical A–Z) for Groups and Topics
- Expand/Collapse toggle button (`‹` / `›`) with rich tooltips

---

## 4. Notes Tab — Board View (Swimlane Board)

The board is a **vertical stack of full-width lane rows** rendered in `#swimlane-board`. The board scrolls vertically to reveal all lanes. Each lane is a horizontal scroll strip showing notes side by side.

### Overall Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Lane: Group A  (12)  [+ Note]  📖  ▣                                  │
│  W18 – May 2026  │ [note] [note] │ W17 – Apr 2026  │ [note] [note] → │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│ Lane: Group B  (5)                                                    │
│  W18 – May 2026  │ [note] [note] │ W16 – Apr 2026  │ [note]        → │
└──────────────────────────────────────────────────────────────────────┘
↓ board scrolls vertically ↓
```

### Lane Block

- Soft tinted card with rounded corners + colored left border (color = lane's hue); the header uses the same accent family and selected lanes read a touch stronger than unselected lanes
- Lanes sorted by newest note (newest first); ties fall back to alphabetical. `(Untagged)` always last
- User preference: Lane sorting can be changed in Preferences → Appearance → "Lane sorting" (Newest first | Alphabetical). The chosen value is persisted to localStorage (`secretaryLaneSort`) and folder settings when saved.
- Collapse state persisted in `localStorage` as `secretaryCollapsedLanes`

**Lane header** (clicking the header area cycles lane state):
| Element | Behavior |
|---|---|
| Colored dot swatch | Visual only |
| Lane name (colored text) | **Click**: sets group/major filter to this lane value (stops propagation, does NOT change lane state) |
| `+ Note` button | Opens a blank new note overlay; the note stays in the shared `(Untagged)` lane until tags are added |
| `(n)` count | Number of notes in lane |
| `✎ Edit` button (group/major lanes) | Opens the Label Manager for that lane label |
| `📖` button | Opens **Focus View** for this lane |
| `▢ Maximize` button | Toggles the lane between default and maximized height |
| `— Minimize` button | Restores the lane to its default height |
| Header click | Cycles lane state: `Minimize` (thick line) → `Normal` (half-filled square) → `Maximize` (full square). The direct buttons avoid the old rotating icon behavior. State persists for collapsed lanes in `localStorage` (`secretaryCollapsedLanes`). |

**Sub-tabs** (subtabs bar, shown when lane has multiple sub-values):
- Shown between header and cards when a lane contains notes from multiple secondary categories
- E.g., when axis = Group: subtabs filter by major topic within the lane
- E.g., when axis = Major Topics: subtabs filter by topic within the lane
- Pills: `All` (neutral) + each distinct sub-value; each colored with its deterministic topic color (`colorForGroup(v)`) — colored border and text when inactive, solid fill when active

**Note cards** inside the lane:
- Grouped by **ISO week** with a vertical separator between groups; label format: `W18 – May 2026` (month = Monday of that week). Newest week is leftmost.
- Within each week: notes displayed **side by side horizontally** (left → right)
- Each card is 200 px wide normally, fixed height ~240 px; maximized lanes widen cards to ~390 px; lane scrolls horizontally for more weeks/notes
- **Vertical mouse-wheel** over a lane is intercepted and redirected to horizontal scroll (natural scroll gesture)

**Note card content:**
- Topic tag chips above the title (group/major context is already given by the lane and subtabs); tag rows are capped at 2 lines and always reserve space
  - Topic tags: **deterministic hue color** from `colorForGroup(tagName)` — **display only, not clickable**
- Title (bold, navy, 2-line clamp; space is reserved even for short titles)
- Date (small, grey; single-line reserved row)
- TODO badges (`HIGH` / `MED` / `WIP` / `LOW`) reserve space at the bottom even when absent
- Preview text: lazy-loaded plain-text excerpt, max 6 lines in maximized lanes (loaded asynchronously after render)
- Notes with highlights replace the excerpt on the card with a compact highlight strip confined to the card width: a subtle left accent (using the lane color) plus a stacked list of highlight items that fills the available card height. Highlights are shown in full (not yellow) and will **scroll vertically** if they exceed the card's space (no horizontal scrolling); the highlight panel uses rounded corners and padding so each note's highlights are visually separated from neighbouring notes. Cards without highlights keep the plain-text preview.
- Drag handle (`⠿`) sits flush to the left edge so note text lines up consistently across cards

**Note card interactions:**
- **Single click**: does nothing — card is passive
- **Double-click anywhere on card** (except drag handle): opens the note in the **overlay in VIEW mode**
- **Right-click (context menu)**: opens a small menu with quick actions — `Edit` (open directly in editor), `Open` (view), `New note from this (copy tags)`, `Copy tags to clipboard`, and `Delete` (permanently remove note after confirmation).
- **Drag handle (`⠿`)**: drag the card to a different lane to move it (reassigns primary group/major tag)

**Lane height:** Each lane is full-width. `.sl-cards` has a fixed height of 170 px showing approximately one note at a time; scroll right (or use mouse wheel) to see more notes across weeks.

**Maximize behavior:** Clicking the lane toggle cycles to `Maximize` which expands that lane to fill the available vertical space in the board while preserving the board's horizontal scrolling. Week groups remain vertical separators (dividers stretch the full lane height). Within a maximized lane, the note grid calculates how many 240 px rows fit in the available height and wraps cards into that many rows automatically. Additionally, note cards increase width to ~390 px to improve readability; wrapping occurs within each week group so cards flow into additional rows while week dividers stay full-height. Maximized lanes are session-only (tracked in `maximizedLanes`) and do not persist to localStorage.

---

### Week Axis (`laneAxis = 'week'`)

Activated by clicking the **Weeks** axis pill in the sub-row.

**Lane structure:**
- Each lane = one ISO calendar week (e.g., `W19 – May · Current`, `W18 – Apr · Last Week`, `W17 – Apr`, …)
- Lanes sorted **newest first** (top = most recent week)
- A final **Older Notes** lane at the bottom collects all notes older than the configured cutoff (default: 8 weeks) plus any undated notes
- Lane colors: gradient from **green** (newest/top) → **amber/red** (oldest/bottom); "Older Notes" lane uses neutral slate grey
- The cutoff threshold is configurable in Preferences → Appearance → "Older notes threshold"

**Lane labels:**
| Condition | Label |
|---|---|
| Current week | `W19 – May · Current` |
| Previous week | `W18 – Apr · Last Week` |
| Earlier (same year) | `W17 – Apr` |
| Earlier (different year) | `W08 – Feb 2025` |
| Catch-all lane | `Older Notes` |

- `· Current` and `· Last Week` are derived from the user's current local calendar week, not from note metadata.
- Malformed date strings are treated as undated and fall into `Older Notes` instead of being rolled forward into a future week.

**Within each week lane — sub-groups:**
- Notes inside a lane are divided into sub-groups by the **"by:"** selector (global, in the sub-row)
- Sub-grouping options:
  - **Day** (default): Monday … Sunday; unknown date → last group
  - **Group**: by first group tag
  - **Major Topic**: by first major topic tag
  - **Topic**: by first topic tag
- Sub-groups are separated by the same vertical bar (`sl-week-sep`) used in Group/Major lanes for week dividers
- Sub-group label appears above the cards (`sl-week-lbl`)

**Note cards in week lanes:**
- Show **group + major + topic** tag chips (since the lane itself does not give group/major context)
- **No drag handle** — week lanes are read-only; the note date can only be changed via the editor overlay
- Double-click, context menu, and all other card interactions work normally

**Left sidebar (Weeks axis):**
- Title = "Weeks"
- Items = one entry per week lane + "Older Notes" (if non-empty)
- Each item uses the week's gradient color
- Clicking scrolls to that lane (no filter change, unlike Group/Major axis)

---


**Triggered by:** clicking the `📖` button in any lane header.

### Layout

Two-panel layout replacing the entire board:

```
┌─────────────────────────────────────────────────────────────┐
│ [← Board]  📖 Group A  3 notes               [⊞ Full screen] │
├──────────────────┬──────────────────────────────────────────┤
│ Tag Bank         │ ┌─────────────────────────────────────┐  │
│ Group: [chip]    │ │ Note Title 1      [tag] [✏️ Edit] ▣  │  │
│ Major: [chip]    │ │─────────────────────────────────────│  │
│ Topic: [chip]    │ │ <rendered HTML content preview>      │  │
│                  │ └─────────────────────────────────────┘  │
│ Notes ▸          │ ┌─────────────────────────────────────┐  │
│ ☑ Note 1  date   │ │ Note Title 2          [✏️ Edit] ▣    │  │
│ ☑ Note 2  date   │ └─────────────────────────────────────┘  │
│ ☑ Note 3  date   │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

Right notes panel & tag bank drawer
- Focus view layout
  - Main: central pane contains stacked note cards (flex:1).
  - Right: Notes panel (collapsed by default) — opens via the `Notes` topbar button; shows the hierarchical notes tree (Group → Major → Topic → Note) or a flat list. When opened the container receives the `.notes-open` class and a 260px right-side notes panel transitions into view.
  - Far-right: Tag Bank drawer (opened via the `Tags` topbar button) — slides in from the far right above the notes panel. When open the drawer shows highlights-first to reduce noise. The drawer header shows an icon-only close button `✕` placed top-left and a pane header button (🏷️ Tag Bank) on the same row; both controls include accessible aria labels. The right-hand notes panel uses the same header layout: left `✕` close + pane header button on the same row so title and close are aligned.
- Interactions
  - Single-click a tree node toggles expand/collapse; double-click applies the global major/topic filter (does NOT hide the tree).
  - Hovering a node shows a small select control to select/deselect all notes under that node; checked notes appear in the right panel.
  - Tag chips are draggable; dropping a chip onto any part of a note card adds the tag to the note and updates the manifest.
- Visual & animation rules
  - Drawer open/close: width + subtle translate + opacity, 240ms ease (opacity fade 180ms).
  - Note body collapse/expand: animate max-height + opacity, ~220–240ms ease.
  - Tree chevrons rotate with 140ms ease.
  - Topbar `Tags` and `Notes` buttons animate subtly toward the pane when opening as an affordance.
- Accessibility
  - Use native <details>/<summary> for tree nodes to preserve keyboard/aria semantics; ensure aria-expanded matches state.


**Right panel (flex: 1, scrollable):**
- Stacked **note cards**, one per visible note, sorted newest-first
- Each card shows: title, date, tags (read-only display), a compact highlight strip above the preview when present, `✏️ Edit` button, collapse icon
- **Single click on card header**: schedules collapse/expand toggle after 260 ms debounce (does NOT fire if a second click follows within that window)
- **Double-click on card header or card body**: open the note overlay directly in **EDIT mode**
- **`✏️ Edit` button**: open the note overlay directly in **EDIT mode**
- **Collapsed state**: body (content) hidden, header still visible; collapse icon becomes a bar
- **Hover**: shows the open/edit hint plus highlight snippets when the note contains highlights

**Focus view top bar:**
- `← Board` button: returns to normal board view (calls `closeLaneFocus()`)
- Lane name and note count (works for Group, Major Topics, and Weeks lanes)
- `⊞ Full screen` / `⊡ Exit` button: toggles `fl-fullscreen` class (fixed positioning over entire viewport, z-index 800)

---

## 6. Note Overlay (View & Edit)

**Triggered by:** clicking any note card (from board or focus view).

The overlay is a **fixed full-screen dim** (z-index 1000) with a centered white panel (max-width 1100px). Clicking outside the panel closes the overlay (click-on-backdrop behavior, but only if mousedown also started outside).

### View Mode (default for existing notes)

The overlay opens in **VIEW mode** when a note card is clicked.

**Header row** (right-aligned controls):
| Control | Behavior |
|---|---|
| `✏️ Edit` button | Switches overlay to edit mode |
| `🗑` delete button | Prompts confirmation, then deletes note file |
| `↗` new window button | Opens note in a new browser tab (bookmarkable URL `#note=<id>`) |
| `✕` close button | Closes overlay (runs final save if edit mode was active) |

**View mode body:**
- Note title (large, navy, bold)
- Date + tag chips (group/major/topic, read-only, non-interactive)
- Highlight summary section (when present) appears above the rendered body; inline `<mark>` highlights keep a soft accent inside the content
- Rendered HTML note content (full body, scrollable)
- Inline note-todo markers inside the rendered body are clickable and open the linked todo overlay; if the todo does not exist yet, the app prompts to create it
- Editor toolbar is **NOT visible** in view mode
- Auto-save indicator is **NOT visible** in view mode

Keyboard: `ESC` closes the overlay.

### Edit Mode

**Triggered by:** clicking `✏️ Edit` in the overlay header, opening a *new* note (path = null), or double-clicking a note card in the focus/reading view.

**Edit mode shows:**
1. **Metadata fields** (above the editor):
   - Title (text input)
   - Date (date picker)
   - Group tags (tag editor — pills with × remove, inline autocomplete input)
   - Major tags (tag editor)
   - Topic tags (tag editor with autocomplete + suggestion dropdown)
   - Extra tags (tag editor — used for TODO HIGH/MED/WIP/LOW markers)
   - Labels are global metadata; the file path stays stable, so there is no rename/move warning on save

2. **Toolbar row:**
   - Visual zoom controls (`100%`, zoom in/out)
   - `+ Todo` / `Link todo` / `+ Decision` buttons: insert or link inline TODO/Decision markers directly in the editor.
   - `🖍 Highlight` button: wraps current text selection in `<mark>`.
   - Rich formatting: `H1`, `H2`, `H3`, **B** (bold), *I* (italic), <u>U</u> (underline), <s>S</s> (strikethrough), `Code`, blockquote, lists, checklists, HR, link, table.

3. **WYSIWYG Editor Pane**:
   - Single rich `contenteditable` container (`#edit-textarea`) displaying formatted HTML in real-time as you type.
   - In view / read-only mode (e.g. Auditor associated notes), `contenteditable="false"` is applied to disable editing while preserving full HTML formatting and interactivity.

**Auto-save:** triggered 1.5 seconds after the last keystroke (`scheduleAutoSave()`). Save indicator shows: `Saving…` → `Saved ✓` (disappears after 2 s) or `⚠ Save failed`.

**On close (✕ or ESC):**
- Runs a final save that writes the current metadata and content back to the same note file
- Removes the `#note=<id>` URL hash
- Re-renders the board

**Multi-window support:** if the same note is modified in another browser window, a yellow reload banner appears in the overlay (`⚠ Updated in another window. [↩ Reload] [Dismiss]`).

### New Note Overlay

Opened via `+ Note` button in a lane header, or programmatically. Opens directly in **edit mode** (no view mode first). Path is null until first save; the note starts blank and lives in the shared `(Untagged)` lane until tags are added. The first save creates a stable `notes/{note-id}.html` file once title + date are non-empty.

---

## 7. Todos Tab

The Todos board uses the same `#swimlane-board` container.

### Layout

Four lanes are rendered as vertical columns:
- **High** (red, `#fee2e2` / `#b91c1c`)
- **Medium** (amber, `#fffbeb` / `#92400e`)
- **Low** (green, `#ecfdf5` / `#065f46`)
- **Done** (grey, `#f3f4f6` / `#6b7280`) — hidden by default; shown when "Show Done" is ON

`status: 'WIP'` is a stored todo-model flag, not a lane. WIP cards stay in their normal priority lane and render with a blue badge / pale blue tint.

Each lane is collapsible (same behavior as note lanes).

### Todo Cards

- Show: `⠿` grip icon, `#rank` number (global rank across High+Medium+Low), priority badge, title, owner/source/context metadata when available; WIP cards use the blue badge/treatment
- **Rank numbering**: Rank follows the visible priority lanes; WIP status does not change lane position or rank
- Done todos have no rank number
- **Draggable** between priority lanes and between positions within a lane; card-edge indicators show the in-lane insertion point, while lane-background drops target the start/end of the lane
- **Click on card**: opens todo overlay

### Topbar Controls (Todos mode)

- **Show Done** button: toggles visibility of Done lane; button stays highlighted when active
- **🗑 Clear Done** button: confirms and permanently deletes all Done todos

### Todo Overlay

Opens on card click. Has two modes:

**View mode:**
- Shows priority badge, rank, title, owner (if set), WIP status line when applicable, description/context (if set), source note link; panel is kept compact to reduce vertical space
- `✏️ Edit` button is always available from view mode
- `✅ Set Done` button: moves todo to Done; shows ✅ banner confirmation
- `↩ Re-open as` + priority select: shown for Done todos to restore them to High/Medium/Low
- `Close` button

**Edit mode:**
- Fields: Title, Priority (High/Medium/Low/Done), Status (WIP checkbox), Owner, Description/Context; laid out as a compact two-column grid
- `Cancel` button: closes the overlay without saving
- `🗑 Delete` button (red): permanently deletes todo after confirmation
- `Save` button: saves changes

---

## 8. Preferences Tab

Opened via the `⚙` icon in the top-right of the top bar. Left sidebar hidden. Three sections:

### Appearance
- **Theme**: System / Light / Dark (system = follows OS preference)
- **Colors grid**: 7 customizable CSS color values:
  - Background, Text, Accent (top bar color), Card, Card Alt, Rank Badge bg, Rank Badge text
  - Color pickers update styles live (via injected `<style>` tag)
  - Changes are saved locally (localStorage) and optionally to `secretary-settings.json` in the folder
- **Lane sorting**: Newest first | Alphabetical — controls lane order in Group/Major axis boards
- **Older notes threshold (weeks)**: integer 1–104, default 8. Notes older than this appear in the "Older Notes" catch-all lane when axis = Weeks. Saved to `settings.ui.weekCutoffWeeks` + localStorage (`secretaryWeekCutoff`).

### Language
- Selector (currently English only)

### Folder
- **Saved folder**: shows current folder name; buttons to Change (re-pick) or Forget (clear IDB handle)
- **Load** button: reads `secretary-settings.json` from current folder and applies settings
- **Save** button: writes `secretary-settings.json` to folder + saves to localStorage
- **🔄 Rebuild** button: rebuilds `index.html` and `todos/index.html` from disk

---

## 9. Topics & Colors

### Tag Hierarchy

Notes have four tag types, each stored in HTML `<meta>` tags:

| Tag type | HTML name | Description |
|---|---|---|
| `group` | `group-tags` | Top-level grouping (e.g., "Calls", "Projects") |
| `major` | `major-topic-tags` | Major project or workstream (e.g., "SMP", "TP") |
| `topic` | `topic-tags` | Specific meeting or series topic |
| `extra` | `extra-tags` | Freeform extras; also holds `TODO HIGH`/`TODO MED`/`TODO WIP`/`TODO LOW` markers |

### Color Logic

**Fixed palette colors** (used for tag pills in board/filter bar):
| Tag type | Background | Text |
|---|---|---|
| Group | `#bfdbfe` | `#1d4ed8` |
| Major | `#fde68a` | `#9a3412` |
| Topic | `#bbf7d0` | `#166534` |

**Topic card and lane colors — deterministic hash:**
```js
colorForGroup(name) → { bg: `hsl(hue, 72%, 92%)`, text: `hsl(hue, 68%, 24%)` }
// hue = hash of name string mod 360
```
This means every topic tag name and lane label always gets the same color everywhere in the app, while the fixed board/filter chips above keep the static palette.

**Lanes** use the same `colorForGroup` to set their left border color and lane name text color.

**Left nav sidebar swatches** use the computed `bg` as background and abbreviation letters in `text` color.

### Tag Chips — Read-Only in Board/Focus View

Tag chips on note cards and in the focus view are **read-only display labels**. They are:
- **Not clickable** on note cards in the board view
- NOT editable inline in board or focus view

Tags can only be edited inside the **overlay editor** (edit mode), using the tag editor fields.

---

## 10. General UX Conventions

### Click Semantics

| Interaction | Result |
|---|---|
| Single click on note card (board view) | Does nothing — card is passive |
| Double-click on note card (board view) | Open overlay in **VIEW** (read) mode |
| Single click on note card header (focus view) | Toggle collapse/expand (260 ms debounce) |
| Double-click on note card header or body (focus view) | Open overlay in **EDIT** mode directly |
| `✏️ Edit` button (focus view) | Open overlay in **EDIT** mode directly |
| Single click on inline note-todo marker (view/focus/editor preview) | Open linked todo overlay; prompt to create if missing |
| `✏️ Edit` button (overlay header) | Switch overlay from view mode to edit mode |
| Right-click on todo card (Todos tab) | Opens a quick-actions menu with Edit, Mark in progress / Clear in progress, Set Done / Re-open, Delete |
| Right-click on selected note preview text (edit mode) | Opens a small menu with `Highlight selection` to wrap the selection in `<mark>` |
| Single click on tag chip (board/focus) | Set tag filter |
| Single click on lane name | Set lane filter (does NOT collapse lane) |
| Click on lane header body | Toggle lane collapse |
| Click on focus view note list item | Toggle note visibility in right panel |

- Hover tooltips are shown on clickable controls and note cards to explain the action, especially on icon-only buttons, lane cards, and context menu entries. Card tooltips also include highlight snippets when available.

### Overlay Patterns

- Overlays (`#note-edit-overlay`, `#todo-edit-overlay`) are fixed full-screen dims with a centered white panel.
- Click-outside closes the overlay (only if mousedown also started outside — prevents accidental close during text selection).
- `ESC` key closes the note overlay.
- Note overlay URL hash: `#note=<id>` is set while open, cleared on close.
- Notes can be opened in a dedicated browser window via `↗` button (focused-note-mode: full-width panel, no modal overlay background).

### Scroll Behavior

- The top bar is always visible (flex-shrink: 0, no scroll).
- The app body scrolls via the `#app-main` area (overflow-y: auto).
- Each lane (`sl-lane`) has `max-height: calc(100vh - 54px)` (flex column); the card list inside (`sl-cards`) fills remaining space with `flex: 1; overflow-y: auto` — so the lane never exceeds the viewport and cards scroll internally.
- Vertical wheel input scrolls vertically; horizontal lane scrolling stays native inside the lane strips.
- Focus view right panel is independently scrollable.

### Toast Notifications

- Bottom-right corner, 3-second auto-dismiss.
- Dark navy background for info; red for errors.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `ESC` | Close note overlay |
| `Ctrl+V` in editor | Paste images (base64-encoded inline) |

### Dark Mode

Controlled by `data-theme="dark"` on `<body>`. Applied via CSS attribute selectors. Colors are overridden in `app-base.css` dark-mode rules. Custom color preferences can override dark-mode colors.

### Multi-Window / Cross-Tab Sync

Uses the **BroadcastChannel API** (`_syncChannel`) to synchronize note saves, deletions, and manifest updates across multiple open tabs. When a note saved in another tab is currently open in view mode, the overlay auto-reloads. If in edit mode, a yellow reload banner is shown.

---

## 11. New Note / New Todo Modal

### New Note Modal (`#modal-new-note`)

Opened via quick-create path (not the primary flow). Fields: Title, Date, Group, Major Topic, Topic, Content (with Write/Preview tabs). Markdown preview rendered on demand. Creates a note file immediately on "Create Note".

### New Todo Modal (`#modal-new-todo`)

Opened via `+ Todo` button in todo lanes. Fields: Title (used as filename), Description, Priority, Owner, Context. Creates a `.md` file immediately on "Save".
