# CLAUDE.md - Secretary Developer & Agent Guide

Welcome to the **Secretary** project repository! This guide provides essential context, architecture details, and explicit instructions for external AI agents (like Claude) interacting with or contributing to Secretary.

---

## 1. Project Overview & Architecture

Secretary is a modern, privacy-first desktop application designed for structured thought, task management, time blocking, and collaborative intelligence.

- **Stack**: Vanilla ES6+ JavaScript, HTML5, CSS3, Vite, Vitest, Electron.
- **Data Layer (`js/app-storage.js`)**: File-based storage directly in the user's workspace directory.
- **Key Files & Locations**:
  - `notes/`: Markdown & HTML notes with semantic metadata tags.
  - `todos/manifest.json`: Kanban tasks and Eisenhower matrix items.
  - `planner.json`: Time-blocked weekly calendar events.
  - `planner-proposals.json`: Dedicated inbox for external AI agents to propose calendar events (**located at root workspace: `./planner-proposals.json`**).
  - `colleagues.json`: Team member profiles and interaction history.
  - `secretary-settings.json`: User preferences, theme, and API keys.

---

## 2. Proposing Calendar Events via `planner-proposals.json` (FULLY IMPLEMENTED)

Secretary has a **fully implemented real-time proposals system**. External AI agents can propose meetings, focus blocks, preparation sessions, and calendar invites by appending to `planner-proposals.json`.

### Target File Location:
- **Relative Path**: `./planner-proposals.json` (in the project/workspace root directory).
- **Absolute Path**: `<workspace_root>/planner-proposals.json`.

### How It Works:
1. Secretary constantly monitors `./planner-proposals.json`.
2. When pending proposals are detected, a pulsing review indicator (`✨ Proposals (N)`) appears in the Planner header.
3. In proposal review mode, proposed events render on the weekly calendar grid as dashed blocks.
4. The user can 1-click Quick Accept (`✓`), Dismiss (`✕`), or click to open the modal and customize details before saving to `planner.json`.

### Rules for External Agents (MANDATORY):
- **Append-Only**: NEVER overwrite, clear, or delete existing proposals in `planner-proposals.json`.
- **Deduplication via Unique ID**: Always supply a unique, stable `id` for each proposal (e.g. `"agent-mail-20260916-standup"`). Secretary uses this ID to prevent duplicate entries and calendar overlaps.
- **Status**: Always initialize the proposal with `"status": "pending"`.
- **Supported Event Types**:
  - `"call"`: Voice or video call (e.g. client calls, Zoom / Google Meet conferences, phone calls). Supports linking collaborators and notes.
  - `"sync"`: Team synchronization or 1-on-1 meeting (e.g. daily standups, weekly 1:1, sprint planning). Supports linking collaborators and notes.
  - `"prep"`: Meeting preparation or follow-up buffer block (e.g. preparing presentation slides, reviewing agendas, debriefs).
  - `"work"`: Deep work / focused execution block (e.g. project work, software engineering, writing, research, strategy).
  - `"todo"`: Scheduled work session specifically dedicated to working on and completing a task from the Todo list.
  - `"personal"`: Personal event, break, or private appointment (e.g. lunch break, doctor appointment, workout, private errands).
  - `"ooo"`: Out of Office / leave / travel / holiday (e.g. vacation, public holiday, business travel, day off).
  - `"custom"`: Generic or flexible custom event block.

### JSON Schema:
```json
{
  "_notice": "IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events in this file. Only append new proposals. Secretary tracks processed/accepted proposals by their unique 'id' to prevent duplicate entries and calendar overlaps.",
  "version": 1,
  "proposals": [
    {
      "id": "agent-proposal-20260916-arch-review",
      "title": "Project Architecture Review",
      "date": "2026-09-16",
      "startTime": "14:00",
      "endTime": "15:00",
      "type": "work",
      "description": "Discuss Q4 roadmap and architecture decisions extracted from email invite.",
      "source": "Claude Agent",
      "collaborators": ["Etienne"],
      "status": "pending"
    }
  ]
}
```

---

## 3. Code Quality & Verification Commands

When writing or modifying code in Secretary, follow these rules:

1. **Translations Parity**:
   All UI strings must be defined in `js/translations.js` across all 15 supported languages (`en`, `de`, `fr`, `cs`, `es`, `hu`, `it`, `nl`, `pl`, `pt`, `ro`, `ru`, `sv`, `tr`, `uk`). Never embed hardcoded strings or emojis in translations.
   Validate with:
   ```bash
   python3 development/check_translations.py
   ```

2. **Unit Tests**:
   Run full unit test suite:
   ```bash
   npm test
   ```

3. **Build**:
   Build distribution:
   ```bash
   npm run build
   ```
