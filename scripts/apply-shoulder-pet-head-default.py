from pathlib import Path


def replace_once(text, old, new, label):
    if text.count(old) != 1:
        raise SystemExit(f"{label} anchor count mismatch: expected 1, found {text.count(old)}")
    return text.replace(old, new, 1)


# game.js is intentionally patched in-repo because it is too large for the
# normal contents-API editing path used by the GitHub connector.
game_path = Path("docs/game.js")
game = game_path.read_text()
game = replace_once(
    game,
    "      let s_shoulderPetRotationSource = 'pixel'; // Settings dropdown: selects the live frame used to orient attached shoulder pets.",
    "      let s_shoulderPetRotationSource = 'head'; // Settings dropdown: selects the live frame used to orient attached shoulder pets.",
    "game rotation-source initial default",
)
game = replace_once(
    game,
    "        const requestedSource = String(e.target.value || 'pixel'); // Used here to reject stale or manually-edited DOM values.",
    "        const requestedSource = String(e.target.value || 'head'); // Used here to reject stale or manually-edited DOM values.",
    "game rotation-source empty-value fallback",
)
game = replace_once(
    game,
    "        s_shoulderPetRotationSource = ['pixel', 'body', 'head', 'world'].includes(requestedSource) ? requestedSource : 'pixel';",
    "        s_shoulderPetRotationSource = ['pixel', 'body', 'head', 'world'].includes(requestedSource) ? requestedSource : 'head';",
    "game rotation-source invalid-value fallback",
)
game_path.write_text(game)

index_path = Path("docs/index.html")
index = index_path.read_text()
index = replace_once(
    index,
    '<option value="pixel" selected>Skinned Shoulder Pixel (default)</option>',
    '<option value="pixel">Skinned Shoulder Pixel</option>',
    "settings pixel option",
)
index = replace_once(
    index,
    '<option value="head">Head / Neck</option>',
    '<option value="head" selected>Head / Neck (default)</option>',
    "settings head option",
)
index_path.write_text(index)

parity_path = Path("docs/js/portrait-plane-outline-parity.js")
parity = parity_path.read_text()
parity = replace_once(
    parity,
    "    return (rotationSourceSelect?.value === 'head') ? 'head' : 'pixel';",
    "    return (rotationSourceSelect?.value === 'pixel') ? 'pixel' : 'head';",
    "portrait parity rotation-source fallback",
)
parity_path.write_text(parity)

test_path = Path("scripts/test-shoulder-pet-attack-rotation.js")
test = test_path.read_text()
test = replace_once(
    test,
    "const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the final-transform shoulder-pet pinning order.\n",
    "const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Used to guard the final-transform shoulder-pet pinning order.\nconst indexSource = fs.readFileSync('docs/index.html', 'utf8'); // Guards the Settings UI default shown on fresh sessions.\nconst paritySource = fs.readFileSync('docs/js/portrait-plane-outline-parity.js', 'utf8'); // Guards the runtime parity fallback when no explicit source is selected.\n",
    "test source declarations",
)
test = replace_once(
    test,
    "for (const source of ['pixel', 'body', 'head', 'world']) {\n  assert.match(gameSource, new RegExp(`case '${source}'`), `rotation source option ${source} is implemented`);\n}\n",
    "for (const source of ['pixel', 'body', 'head', 'world']) {\n  assert.match(gameSource, new RegExp(`case '${source}'`), `rotation source option ${source} is implemented`);\n}\nassert.match(gameSource,\n  /let s_shoulderPetRotationSource = 'head';/,\n  'fresh gameplay state defaults shoulder-pet rotation to head/neck');\nassert.match(gameSource,\n  /String\\(e\\.target\\.value \\|\\| 'head'\\)[\\s\\S]{0,240}\\? requestedSource : 'head';/,\n  'empty or invalid shoulder-pet rotation settings fall back to head/neck');\nassert.match(indexSource,\n  /<option value=\"head\" selected>Head \\/ Neck \\(default\\)<\\/option>/,\n  'the Settings dropdown presents head/neck as the default');\nassert.match(paritySource,\n  /return \\(rotationSourceSelect\\?\\.value === 'pixel'\\) \\? 'pixel' : 'head';/,\n  'the portrait parity controller defaults to head/neck while preserving explicit pixel mode');\n",
    "default-source regression assertions",
)
test_path.write_text(test)

print("shoulder-pet head/neck default patch applied")
