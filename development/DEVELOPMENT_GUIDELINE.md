# Development Guideline: Clickable Element Tooltips & Localization

To ensure high usability, accessibility, and professional design, all interactive/clickable elements in the **Secretary** application must follow the hover tooltip guidelines outlined in this document.

---

## 1. Hover Tooltip Requirement (The `title` Attribute)

Every clickable or interactive element (buttons, links, select inputs, text areas, tab switchers) **must** show a descriptive tooltip when hovered over. This is achieved using the HTML `title` attribute.

---

## 2. Tooltip Content Policy: Action and Outcome Description

The tooltip content **must not** be equal to the label written on the element. Instead, it must explicitly describe **what will happen** (the action or outcome) when the user clicks or interacts with the element.

*   **Rule**: `element.title != element.textContent` (or `element.value`).
*   **Purpose**: A user hovering over a button already knows its label (e.g. "Save"). The tooltip should explain the consequence of that action (e.g. "Write current changes to disk").

### Examples:

| Clickable Element | Element Label | Non-Compliant Tooltip (Fails) | Compliant Tooltip (Passes) |
| :--- | :--- | :--- | :--- |
| **Notes Tab** | `📝 Notes` | `📝 Notes` | `Switch to the notes board to browse and edit your Markdown files` |
| **Delete Button** | `🗑 Delete` | `Delete` or `🗑 Delete` | `Permanently delete this note file from disk` |
| **Save Button** | `Save` | `Save current note` | `Write current changes to settings.json inside the current folder` |
| **Sync Button** | `Sync` | `Sync note` | `Create or open a 1-on-1 synchronization note for this teammate` |
| **WIP Toggle** | `In progress` | `Mark in progress` | `Toggle the 'Work In Progress' status of this task` |

---

## 3. Localization Requirement

All hover tooltips must be fully externalized and localized. **Hardcoding strings in the HTML or Javascript logic is strictly prohibited.**

1.  **Add Keys to Translation File**: All UI text and tooltips must have an entry in `js/translations.js` for all 15 supported languages.
2.  **Retrieve via Translation Helper**: Retrieve the translation using the `t('key')` helper function.
3.  **Assign Dynamic Tooltips**: Set dynamically created elements' tooltips programmatically using `element.title = t('key', { variables })` or `setElementTitle('#id', t('key'))`.

### Compliant JS Code Pattern:

```javascript
// Dynamic context menu button example
const btn = document.createElement('button');
btn.textContent = t('editor.editNote'); // Label: "Edit note"
btn.title = t('editor.editNoteTooltip');  // Tooltip: "Modify the content of this note in the editor overlay"
```

---

## 4. AI Agent Guidelines: Translation Management

When adding new features, UI buttons, tooltips, or text strings to the codebase, **AI agents must follow this workflow**:

### Step 1: Add New Keys to `js/translations.js`
Open `js/translations.js` and add your new key mapping under `translations` with values for all 15 supported languages (`en`, `de`, `fr`, `cs`, `es`, `hu`, `it`, `nl`, `pl`, `pt`, `ro`, `ru`, `sv`, `tr`, `uk`):

```json
"myFeature.newButtonTooltip": {
  "en": "Perform action and update state",
  "de": "Aktion ausführen und Status aktualisieren",
  "fr": "Exécuter l'action et mettre à jour l'état",
  "cs": "Provést akci a aktualizovat stav",
  "es": "Ejecutar acción y actualizar estado",
  "hu": "Művelet végrehajtása és állapot frissítése",
  "it": "Esegui azione e aggiorna stato",
  "nl": "Actie uitvoeren en status bijwerken",
  "pl": "Wykonaj akcję i zaktualizuj stan",
  "pt": "Executar ação e atualizar estado",
  "ro": "Execută acțiunea și actualizează starea",
  "ru": "Выполнить действие и обновить состояние",
  "sv": "Utför åtgärd och uppdatera status",
  "tr": "Eylemi gerçekleştir ve durumu güncelle",
  "uk": "Виконати дію та оновити стан"
}
```

### Step 2: Validate Parity
Run the verification script to ensure zero missing keys across all 15 languages:
```bash
python3 development/check_translations.py
```
