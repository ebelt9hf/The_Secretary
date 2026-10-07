#!/usr/bin/env python3
"""
Common i18n file handling utility for Secretary repository.
Single source of truth: `js/translations.js`
"""

import os
import json
import re

WORKSPACE = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
TRANSLATIONS_JS_PATH = os.path.join(WORKSPACE, "js", "translations.js")


def load_translations_bundle(path=TRANSLATIONS_JS_PATH):
    """Loads and parses the translation bundle from js/translations.js."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Translation bundle not found at {path}")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read().strip()
    match = re.search(r'window\.APP_TRANSLATIONS_BUNDLE\s*=\s*(\{[\s\S]*\});?\s*$', content)
    if match:
        return json.loads(match.group(1))
    return json.loads(content)


def save_translations_bundle(bundle_data, path=TRANSLATIONS_JS_PATH):
    """Sorts keys alphabetically and writes the canonical bundle to js/translations.js."""
    translations = bundle_data.get("translations", {})
    metadata = bundle_data.get("metadata", {})
    sorted_translations = {k: translations[k] for k in sorted(translations.keys())}
    metadata["total_keys"] = len(sorted_translations)
    bundle_data["metadata"] = metadata
    bundle_data["translations"] = sorted_translations

    with open(path, "w", encoding="utf-8") as f:
        f.write("window.APP_TRANSLATIONS_BUNDLE = ")
        json.dump(bundle_data, f, indent=2, ensure_ascii=False)
        f.write(";\n")
