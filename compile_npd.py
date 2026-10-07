#!/usr/bin/env python3
"""
NPD Compiler Root Wrapper for Secretary.
Delegates execution to development/compile_npd.py.
"""
import os
import sys
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
DEV_SCRIPT = os.path.join(SCRIPT_DIR, "development", "compile_npd.py")

if __name__ == "__main__":
    cmd = [sys.executable, DEV_SCRIPT] + sys.argv[1:]
    sys.exit(subprocess.call(cmd))
