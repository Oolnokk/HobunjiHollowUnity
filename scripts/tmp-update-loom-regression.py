from pathlib import Path

path = Path('scripts/test-clothing-weaving-system.js')
text = path.read_text(encoding='utf-8')
old = """assert.match(gameSource, /if \\(o\\.key === 'loom'\\) return makeLoomInteractable\\(\\)/, 'player-placed house loom is a normal interior furniture interactable');
assert.match(gameSource, /loomFurniture: \\(\\) => makeLoomInteractable\\(\\)/, 'map-authored loom uses the same core interactable factory');
assert.match(gameSource, /function makeLoomInteractable\\(\\)/, 'loom interaction is owned by the core furniture system');
"""
new = """assert.match(gameSource, /if \\(o\\.key === 'loom'\\) return makeLoomInteractable\\(false\\)/, 'player-placed Simple Loom uses the core loom interactable without overpass capability');
assert.match(gameSource, /loomFurniture: \\(\\) => makeLoomInteractable\\(false\\)/, 'map-authored Simple Loom uses the same capability-gated core interactable');
assert.match(gameSource, /function makeLoomInteractable\\(advanced = false\\)/, 'loom interaction is owned by the core furniture system and defaults to Simple Loom capability');
"""
if text.count(old) != 1:
    raise RuntimeError('stale loom regression block was not found exactly once')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
Path(__file__).unlink(missing_ok=True)
