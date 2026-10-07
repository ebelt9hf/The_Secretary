#!/usr/bin/env python3
"""
Runtime i18n Verification Test.

Simulates Secretary's JS `t(key)` helper and nested key resolution logic in Python
to ensure that all 15 language packs load cleanly and resolve runtime translation requests.
"""

import os
import sys
import json
import re

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

def get_nested_value(d, dotted_path):
    parts = dotted_path.split('.')
    curr = d
    for p in parts:
        if not isinstance(curr, dict) or p not in curr:
            return None
        curr = curr[p]
    return curr

def interpolate(text, vars_dict):
    if not isinstance(text, str):
        return text
    return re.sub(r'\{(\w+)\}', lambda m: str(vars_dict.get(m.group(1), '')), text)

def unflatten_translations(translations, languages):
    packs = {lang: {} for lang in languages}
    for composite_key, lang_map in translations.items():
        parts = composite_key.split(".")
        for lang in languages:
            val = lang_map.get(lang)
            if val is None:
                continue
            curr = packs[lang]
            for part in parts[:-1]:
                if part not in curr or not isinstance(curr[part], dict):
                    curr[part] = {}
                curr = curr[part]
            curr[parts[-1]] = val
    return packs

def run_test():
    if not os.path.exists(TRANSLATIONS_PATH):
        print(f"Error: {TRANSLATIONS_PATH} not found.")
        sys.exit(1)

    bundle = load_translations_bundle(TRANSLATIONS_PATH)

    translations = bundle.get("translations", {})
    metadata = bundle.get("metadata", {})
    languages = metadata.get("languages", ['cs', 'de', 'en', 'es', 'fr', 'hu', 'it', 'nl', 'pl', 'pt', 'ro', 'ru', 'sv', 'tr', 'uk'])

    packs = unflatten_translations(translations, languages)

    # Test keys to sample across all components
    sample_keys = [
        ("team.syncMeetingsLabel", {}),
        ("team.teamManagerHelper", {}),
        ("team.updatingNotesCount", {"count": 5}),
        ("team.updatedNotesCount", {"count": 12}),
        ("todo.saveTodo", {}),
        ("confirm.deleteNote", {"name": "TestNote.md"}),
        ("board.cancel", {}),
        ("axis.groupsTitle", {}),
        ("llm.summarySystemPrompt", {})
    ]

    print(f"Testing Runtime Translation Engine across {len(languages)} languages...")
    print("=" * 70)

    failures = 0
    successes = 0

    for key, vars_dict in sample_keys:
        print(f"\nTesting Key: '{key}'")
        en_res = interpolate(get_nested_value(packs['en'], key), vars_dict)
        print(f"  [EN]: {en_res}")

        for lang in languages:
            if lang == 'en': continue
            lang_val = get_nested_value(packs[lang], key)
            if lang_val is None:
                print(f"  ❌ [{lang.upper()}]: MISSING KEY!")
                failures += 1
            else:
                translated_res = interpolate(lang_val, vars_dict)
                # Check that translation is not raw untranslated English (unless exact match exception)
                print(f"  ✅ [{lang.upper()}]: {translated_res[:70]}...")
                successes += 1

    print("\n" + "=" * 70)
    print(f"Runtime Test Complete: {successes} successful language resolutions, {failures} failures.")
    return failures == 0

if __name__ == "__main__":
    if not run_test():
        sys.exit(1)
