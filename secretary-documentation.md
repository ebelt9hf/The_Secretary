# Secretary Architecture & Features Documentation 📝👥📅

**Secretary** is a private, local-first personal note manager, task organizer, and AI-assisted companion designed to run entirely in the web browser while reading and writing directly to the user's local disk. This document provides a detailed overview of the system's architecture, features, user capabilities, component relationships, and storage structure.

---

## 1. Architectural Principles (The "Backend")

Unlike traditional web applications, Secretary has **no server-side backend** (e.g., no Node.js/Python server, no database daemon). Instead, it operates on a local-first, serverless architecture:

*   **Execution Context**: Runs client-side as a Single Page Application (SPA) in the web browser via `app.html` or as a standalone desktop app via **Electron**.
*   **Disk Access (File System Access API)**: Reads and writes files directly to a folder on your hard drive using native browser `showDirectoryPicker()` handles.
*   **IndexedDB Persistence**: Persists directory handle permissions across sessions so that on reload, the user can click **↩ Resume last folder** to resume work instantly.
*   **Multi-Tab Sync**: Uses the browser's `BroadcastChannel` (channel named `'secretary-sync'`) to notify other open tabs of modifications in real-time, trigger index rebuilds, and refresh the UI.
*   **Security & Privacy**: All personal data, notes, and schedules remain on the local machine. Network traffic is restricted to optional local/remote LLM assistant endpoints.

---

## 2. Workspace Storage & Directory Structure

When a directory is mounted, Secretary expects and maintains the following structure under the hood:

```text
[Mounted Root Folder]/
├── secretary-settings.json   # Theme, username, AI configuration, and colleague list
├── planner.json              # Weekly planner schedules and time-blocked events
├── planner-proposals.json    # Agent-proposed events inbox (read & autodetected by Secretary)
├── planner-proposals.template.json # Reference schema & example for external agents
├── colleagues.json           # Detailed colleagues records and manager/peer hierarchies
├── stash/                    # Inbox folder containing raw captured thoughts
│   └── capture-[timestamp].txt
├── notes/                    # Subdirectory for note files
│   ├── manifest.json         # Note index mapping paths, dates, titles, and tags
│   ├── metadata-buffer.json  # Decision, mention, and delegation fast-cache
│   └── [note-name].html      # Individual notes stored as HTML files containing metadata
└── todos/                    # Subdirectory for task files
    └── manifest.json         # Kanban board index for active tasks
```

### File Formats & Schemas:
1.  **Notes (`notes/*.html`)**: Individual notes are saved as HTML pages.
    *   **Metadata**: Stored in standard `<meta>` elements at the top:
        ```html
        <meta name="note-id" content="note-1234">
        <meta name="group-tags" content="Project A, Work">
        <meta name="major-topic-tags" content="Development">
        <meta name="topic-tags" content="Refactoring">
        <meta name="reviewed" content="true">
        ```
    *   **Summary**: Placed inside `<section id="note-summary">` tags.
    *   **Body Content**: Kept inside a `<main>` container, representing rich formatted HTML content.
2.  **Todos (`todos/manifest.json`)**: Kanban tasks stored in a structured JSON index file categorizing items by status, priority, due date, quadrant, and assignee.
3.  **Settings (`secretary-settings.json`)**: JSON file storing UI preferences (theme, working hours, active days), user profile details, and AI API keys/endpoints.
4.  **Agent Planner Proposals (`planner-proposals.json`)**: Dedicated inbox file for external AI agents or automation scripts running on the user's computer.
    *   **Append-Only Rule**: External agents must **never** delete existing entries from this file; they should only append new proposals. Secretary tracks processed/accepted proposals by their unique `id` to prevent duplicates or overlaps.
    *   **Schema**:
        ```json
        {
          "_notice": "IMPORTANT FOR AGENTS: Do NOT delete or overwrite existing proposed events in this file. Only append new proposals. Secretary tracks processed/accepted proposals by their unique 'id'.",
          "version": 1,
          "proposals": [
            {
              "id": "unique-agent-proposal-id",
              "title": "Discussion: Q4 Architecture",
              "date": "2026-09-16",
              "startTime": "14:00",
              "endTime": "15:00",
              "type": "work",
              "description": "Proposed by CodeAgent: Review system architecture",
              "source": "CodeAgent",
              "collaborators": ["Etienne"],
              "status": "pending"
            }
          ]
        }
        ```
    *   **Supported Event Types (`type`)**:
        *   `call`: Voice/video meetings and external calls (supports linked notes and collaborators).
        *   `sync`: Internal team syncs, 1-on-1s, standups (supports linked notes and collaborators).
        *   `prep`: Meeting prep or follow-up buffer block associated with a call/meeting.
        *   `work`: Deep work focus sessions for projects (supports project tags and notes).
        *   `todo`: Scheduled work session dedicated to completing a task from the Todo list.
        *   `personal`: Personal breaks, private errands, meals, or medical appointments.
        *   `ooo`: Out of office / leave / vacation / travel.
        *   `custom`: Flexible or custom calendar block.
    *   **Workflow**: Proposals are hidden by default to keep the calendar uncluttered. When pending proposals are detected, a pulsing review button appears in the planner toolbar. Activating review mode renders them as dashed blocks; the user can click any block to customize details and commit it to `planner.json`.

---

## 3. Core Features & User Capabilities

### 📝 Notes Board & Editor
*   **Interactive Swimlanes**: Browse notes organized dynamically by **Group**, **Major Topic**, or **Week** lanes. Notes inside week lanes can be further sub-grouped by Day, Group, Major, or Topic.
*   **Taxonomy Management**: Assign hierarchical metadata tags (Group → Major Topic → Topic → Extra Tags).
*   **Rich Text Note Editor**: Edit notes in real-time with rich formatting (headings, lists, checkboxes, callouts, tables, and images) directly in HTML.
*   **Search**: Search notes by title, tags, or content. Supports case sensitivity and regex searches.

### 📋 Kanban Tasks & Eisenhower Matrix
*   **Priority Lanes**: Organize action items into High, Medium, Low, and Done columns.
*   **Eisenhower Matrix Scatterplot**: Interactive 2D graph view visualizing tasks as compact draggable dots ("tods") mapped across Urgency and Importance quadrants.
*   **WIP (Work In Progress) Tracking**: Limits number of concurrent tasks in active lanes to prevent overload.
*   **Context Control**: Right-click context menus allow quick changes to priority, status, assignee, or deletion.

### 📅 Weekly Planner, Proposals & ICS Import
*   **Time Blocking**: Book specific slots for prep work, work sessions, calls, or administrative tasks.
*   **Agent Proposed Events**: Autodetects calendar proposals written to `planner-proposals.json`, shows a flashing review indicator, and displays them as dashed blocks for 1-click review and commit.
*   **Drag-and-Drop Calendar**: Reorder, extend, or shift tasks on a weekly calendar grid.
*   **iCalendar (.ics) Import**: Import calendar `.ics` files directly into any given day or date range.
*   **Collaborator Linking**: Assign planner events to team members. Events display aliases and link back to relevant notes.

### 👥 Team & Decisions Registry
*   **Teammate Directory**: Track colleague profiles, roles, and current workloads based on open tasks and upcoming planner assignments.
*   **Organizational Hierarchy Chart**: Generate an interactive org chart mapping manager links, direct reports, peers, and ultimate managers.
*   **Decisions Registry**: Scans all notes for decisions (marked with `!decisions` or custom syntax). Displays decisions sequentially with statuses (active, replaced, or superseded).

### 🌙 Daily Review Wizard
A structured 4-step evening walkthrough to organize thoughts and close the day:
1.  **Stash Routing**: Process captured raw text snippets. Convert each to a task, a note, a planned calendar block, or discard it.
2.  **Calendar QA**: Adjust calendar events in the planner to match actual hours spent.
3.  **Normalization & Extraction**: Review notes modified today, check tags, highlight key sentences, and validate them.
4.  **Close Day**: Commit logs, archive finalized structures, and close.

### 📊 Retrospective & Analytics
*   **Time Allocation Analysis**: Aggregates hours spent on Deep Work, Sync, Call/Meeting, OOO, and Admin.
*   **Calculated Metrics**: Computes **Focus Rate %** and **Interruption Index** metrics for weekly reports.
*   **Velocity & Debt tracking**: Compares completed tasks (velocity) with leftover tasks (debt).
*   **Markdown Export**: Generates a rich summary report.

### 💬 AI Chat & Note Copilot
*   **AI Chat Panel**: Multi-conversation chat interface integrating local or remote endpoints (LM Studio, Ollama, Anthropic, OpenAI).
*   **Context Attachment**: Attach relevant notes or tasks to AI context using `@` autocomplete tags.
*   **Local RAG & Tool Execution**: Autonomous tool execution (`search_notes`, `find_relevant_notes`, `get_tasks`, `get_planner_events`, `search_colleagues`) with local context retrieval.
*   **Note Suggestion Cards**: Real-time note analysis suggesting improvements, extracting action items, or logging decisions with visual diff highlights.

---

## 4. Summary of JavaScript Code Modules

| File Name | Primary Responsibility |
| :--- | :--- |
| **[app-init.js](js/app-init.js)** | Entry point. Bootstraps the application, handles folder mounting, binds global events, and setups the tab switcher. |
| **[app-state.js](js/app-state.js)** | Stores and manages global runtime variables, local configurations, and bounded cache structures. |
| **[app-fs.js](js/app-fs.js)** | Thin wrapper over browser File System Access API + IndexedDB persistence helper. |
| **[app-storage.js](js/app-storage.js)** | Data Abstraction Layer (DAL) separating app logic from raw files. |
| **[app-notes.js](js/app-notes.js)** | Handles note CRUD operations, indexing, tag hierarchies, and metadata buffers. |
| **[app-todos-board.js](js/app-todos-board.js)** | Manages Kanban tasks, WIP constraints, priority categories, and Eisenhower scatterplot ("tods"). |
| **[app-planner.js](js/app-planner.js)** | Implements interactive calendar, time blocking, ICS import, and collaborator scheduling. |
| **[app-collab.js](js/app-collab.js)** | Parses mentions, manages colleague databases, renders org charts, and lists the decision log. |
| **[app-dailyreview.js](js/app-dailyreview.js)** | Runs multi-step end-of-day wizard layout and stash routing features. |
| **[app-retro.js](js/app-retro.js)** | Computes time stats and builds retrospective summaries and markdown reports. |
| **[app-llm.js](js/app-llm.js)** | Handles API formatting, suggestion prompts, reasoning effort settings, and difference highlights. |
| **[app-chat.js](js/app-chat.js)** | Manages conversational history, attachments, autocomplete, and local agent tool execution. |
| **[app-overlay.js](js/app-overlay.js)** | Orchestrates editor modal displays, split preview panels, and custom text inputs. |
| **[app-omnibar.js](js/app-omnibar.js)** | Search bar controller enabling rapid workspace navigation. |
| **[app-stash-service.js](js/app-stash-service.js)** | Manages raw stash captures and daily review routing queue. |
| **[app-focus.js](js/app-focus.js)** | Handles focus view mode (`📖`) for deep reading and category filtering. |
| **[app-tutorial.js](js/app-tutorial.js)** | Programmatic step-by-step help tour for first-time users. |
| **[app-utils.js](js/app-utils.js)** | Common helpers (time conversion, strings, markdown parsing, and safety guards). |
| **[app-i18n.js](js/app-i18n.js)** & **[translations.js](js/translations.js)** | Internationalization loader and canonical JavaScript bundle storing strings for all 15 European languages. |
