#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).with_name('apply-flasker-bandit-integration.py')
text = path.read_text()
old = r'''    r"\n  const throwFlask = \{.*?\n  \};\n(?=\n  // Shared temporary throw animation)",'''
new = r'''    r"\n  const throwFlask = \{.*?\n  \};[^\n]*\n(?=\n  // Shared temporary throw animation)",'''
if old not in text:
    raise SystemExit('expected throwFlask regex was not found in integration helper')
path.write_text(text.replace(old, new, 1))
print('Relaxed throwFlask block match to allow its trailing source comment.')
