#!/usr/bin/env python3
"""
Language Equality & Untranslated Audit Tool for Secretary.

Checks if multiple languages have identical strings for a key in `js/translations.json`.
Identical strings across distinct languages usually mean a string was left untranslated
(e.g., English or French text copied everywhere), unless the string or key is in an explicit EXCEPTIONS list.
"""

import os
import sys
import json

WORKSPACE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
TRANSLATIONS_PATH = os.path.join(WORKSPACE, "js", "translations.js")

sys.path.append(os.path.dirname(os.path.realpath(__file__)))
try:
    from i18n_utils import load_translations_bundle
except ImportError:
    def load_translations_bundle(path):
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
        match = re.search(r'window\.APP_TRANSLATIONS_BUNDLE\s*=\s*(\{[\s\S]*\});?\s*$', content)
        if match:
            return json.loads(match.group(1))
        return json.loads(content)

# Genuine universal terms/symbols or specific keys that are identical across languages
GLOBAL_EXCEPTIONS = {
    # Universal tech / brand / symbol terms
    "Secretary", "JSON", "Markdown", "LaTeX", "HTML", "CSS", "ID", "URL", "API", 
    "OK", "Vite", "Electron", "RSS", "UTC", "PDF", "CSV", "ICS", "iCal", "UI",
    "Zoom +", "Zoom -", "Zoom", "1", "2", "3", "4", "5", "@", "http", "https",
    "WIP", "Regex", "AI Secretary",
    "✓", "✕", "⊡", "⊞", "↩", "↻", "📅", "⚡", "📎", "🛠️", "🤖", "‹", "›", "←", "→"
}

KEY_EXCEPTIONS = {
    "app.name",
    "team.zoomIn",
    "team.zoomOut",
    "board.navCompact",
    "todo.wip",
    "todo.priorityWip",
    "topbar.chat",
    "topbar.searchRegexTitle"
}

def audit_language_equality():
    if not os.path.exists(TRANSLATIONS_PATH):
        print(f"Error: Translation file not found at {TRANSLATIONS_PATH}")
        sys.exit(1)

    bundle = load_translations_bundle(TRANSLATIONS_PATH)

    translations = bundle.get("translations", {})
    metadata = bundle.get("metadata", {})
    languages = metadata.get("languages", ['cs', 'de', 'en', 'es', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk'])

    untranslated_keys = {}
    total_keys = len(translations)

    for key, val in translations.items():
        if key in KEY_EXCEPTIONS:
            continue
        if not isinstance(val, dict):
            continue

        en_val = val.get("en")
        fr_val = val.get("fr")

        # Group languages by their translated text
        text_groups = {}
        for lang, text in val.items():
            if isinstance(text, str):
                text_groups.setdefault(text, []).append(lang)

        # Check if any text is shared by 4 or more distinct non-English languages
        for text, langs_with_text in text_groups.items():
            if text in GLOBAL_EXCEPTIONS or len(text) <= 2:
                continue

            # If English or French string is copied across multiple other languages
            non_en_count = len([l for l in langs_with_text if l != 'en'])
            if non_en_count >= 4:
                untranslated_keys[key] = {
                    "text": text,
                    "languages_affected": langs_with_text,
                    "en_text": en_val,
                    "fr_text": fr_val
                }

    print(f"Evaluated {total_keys} keys across {len(languages)} languages.")
    print("=" * 60)

    if untranslated_keys:
        print(f"⚠️  FOUND {len(untranslated_keys)} KEYS WITH EQUAL UNTRANSLATED STRINGS ACROSS LANGUAGES:")
        print("=" * 60)
        for k, info in sorted(untranslated_keys.items()):
            print(f"Key: {k}")
            print(f"  Shared String: \"{info['text']}\"")
            print(f"  Affected ({len(info['languages_affected'])} langs): {info['languages_affected']}")
            print("-" * 50)
        
        print(f"\n❌ Audit failed: {len(untranslated_keys)} keys appear to be untranslated copies.")
        return False, untranslated_keys
    else:
        print("✅ Success! No untranslated duplicate strings found (all exceptions checked).")
        return True, {}

if __name__ == "__main__":
    success, _ = audit_language_equality()
    if not success:
        sys.exit(1)
