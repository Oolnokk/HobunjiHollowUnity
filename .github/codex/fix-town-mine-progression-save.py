from pathlib import Path

mine_path = Path('docs/js/town-mine.js')
text = mine_path.read_text()
old = """  function recordFloorReached(floor) {\n    progression.deepestFloor = Math.max(progression.deepestFloor, Math.max(0, Math.min(100, Math.floor(Number(floor) || 0))));\n  }\n"""
new = """  function recordFloorReached(floor) {\n    const reachedFloor = Math.max(0, Math.min(100, Math.floor(Number(floor) || 0))); // Normalized before comparing so malformed map data can never lower/corrupt progression.\n    if (reachedFloor <= progression.deepestFloor) return false;\n    progression.deepestFloor = reachedFloor;\n    deps?.save?.(); // Reaching a new personal best is progression itself, so persist immediately instead of waiting for an unrelated later save.\n    return true;\n  }\n"""
if old not in text:
    raise SystemExit('recordFloorReached anchor not found')
mine_path.write_text(text.replace(old, new, 1))

test_path = Path('scripts/test-town-mine-descent.js')
test = test_path.read_text()
old = """  const mine = context.window.TownMine;\n  const entrance = townMap.buildings.find(building => building.id === 'bldg_town_mine_entry');\n"""
new = """  const mine = context.window.TownMine;\n  let mineSaveCalls = 0;\n  mine.init({ save: () => { mineSaveCalls += 1; } });\n  mine.restore({ deepestFloor: 4, unlockedShortcutTiers: [], townValue: 0, discoveredOreKeys: [] });\n  assert.strictEqual(mine.recordFloorReached(5), true, 'Reaching a new deepest floor should report progression');\n  assert.strictEqual(mineSaveCalls, 1, 'Reaching a new deepest floor should save immediately');\n  assert.strictEqual(mine.recordFloorReached(3), false, 'Revisiting a shallower floor should not count as new progression');\n  assert.strictEqual(mineSaveCalls, 1, 'Revisiting an older floor should not cause redundant saves');\n  const progressionRoundTrip = mine.serialize();\n  mine.restore(null);\n  assert.strictEqual(mine.serialize().deepestFloor, 0, 'A blank restore should reset mine progression');\n  mine.restore(progressionRoundTrip);\n  assert.strictEqual(mine.serialize().deepestFloor, 5, 'Serialized deepest floor should survive a restore round trip');\n  const entrance = townMap.buildings.find(building => building.id === 'bldg_town_mine_entry');\n"""
if old not in test:
    raise SystemExit('test init anchor not found')
test = test.replace(old, new, 1)
old = """  const gameSource = fs.readFileSync('docs/game.js', 'utf8');\n  const oreDefsMatch = gameSource.match(/const ORE_DEFS = (\\{[\\s\\S]*?\\n      \\}); \\/\\/ Used by mine drops/);\n"""
new = """  const gameSource = fs.readFileSync('docs/game.js', 'utf8');\n  assert.ok(gameSource.includes('member.townMineState = window.TownMine?.serialize?.() || null;'), 'Member-world saves must include Town Mine progression');\n  assert.ok(gameSource.includes('window.TownMine?.restore?.(playerData.townMineState);'), 'Player startup must restore Town Mine progression');\n  const oreDefsMatch = gameSource.match(/const ORE_DEFS = (\\{[\\s\\S]*?\\n      \\}); \\/\\/ Used by mine drops/);\n"""
if old not in test:
    raise SystemExit('gameSource test anchor not found')
test_path.write_text(test.replace(old, new, 1))
