import json
from pathlib import Path

# 1) Generic terrain placement: allow locale floor to derive from the low side
# of required cliff probes. This is intentionally terrain-class agnostic: the
# low side may be ground or another plateau tier.
p = Path('docs/js/locale-terrain-placement.js')
s = p.read_text()
old = '''  function chooseLocaleFloor(context, compiled, anchorC, anchorR) {
    const ordinary = ordinaryFootprintCells(compiled); // Non-embedded cells represent the approach/interior floor rather than host mass being carved away.
    const sample = ordinary.length ? ordinary : [...compiled.tiles.values()];
    const tiers = sample.map(cell => tileTier(context, anchorC + cell.c, anchorR + cell.r)); // Host tiers under floor cells determine the stamped locale's floor.
    if (!tiers.length) return { tier: 0, spread: 0, groupId: null };
    const counts = new Map(); // Rounded tier frequency selects a stable floor in mildly noisy/ramp-adjacent terrain.
    for (const tier of tiers) {
      const key = Number(tier.toFixed(2));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let floorTier = tiers[0]; // Most common host tier becomes locale floor; ties keep the earliest encountered tier.
    let floorCount = -1;
    for (const [tier, count] of counts) if (count > floorCount) { floorCount = count; floorTier = Number(tier); }
    const minTier = Math.min(...tiers); // Tier spread enforces legacy-like flatness on the ordinary footprint when requested.
    const maxTier = Math.max(...tiers);
    let groupId = null; // Matching plateau group lets a raised-floor cave carve into a higher mesa while staying on its lower shelf.
    for (const cell of sample) {
      const worldC = anchorC + cell.c;
      const worldR = anchorR + cell.r;
      const tile = tileRecord(context.root, worldC, worldR);
      if (tile?.plateau && Math.abs(tileTier(context, worldC, worldR) - floorTier) <= 0.05) { groupId = tile.plateau; break; }
    }
    return { tier: floorTier, spread: maxTier - minTier, groupId };
  }
'''
new = '''  function requiredCliffFloor(context, compiled, anchorC, anchorR) {
    const lowTiers = []; // Required cliff faces can define the locale floor from the immediately adjacent low side, regardless of whether that low side is ground or another mesa.
    for (const cell of compiled.probes.values()) {
      const rule = cell.value;
      if (rule.strength !== 'required' || (rule.terrain !== 'plateauCliff' && rule.terrain !== 'boundaryCliff')) continue;
      const requestedKind = rule.terrain === 'boundaryCliff' ? 'boundary' : 'plateau';
      const info = cliffInfo(context, anchorC + cell.c, anchorR + cell.r, requestedKind, rule.facing || 'any');
      if (info) lowTiers.push(info.lowTier);
    }
    if (!lowTiers.length) return null;
    const min = Math.min(...lowTiers);
    const max = Math.max(...lowTiers);
    if (max - min > 0.05) return { error: `required cliff probes disagree on lower tier (spread ${(max - min).toFixed(2)})` };
    return { tier: lowTiers[0], source: 'requiredCliffLowSide' };
  }

  function chooseLocaleFloor(context, compiled, anchorC, anchorR) {
    const ordinary = ordinaryFootprintCells(compiled); // Non-embedded cells represent the approach/interior floor rather than host mass being carved away.
    const sample = ordinary.length ? ordinary : [...compiled.tiles.values()];
    const tiers = sample.map(cell => tileTier(context, anchorC + cell.c, anchorR + cell.r)); // Host tiers under floor cells determine the stamped locale's floor.
    const floorMode = compiled.locale.placement?.floorMode === 'nextLowerCliffTier' ? 'nextLowerCliffTier' : 'footprint';
    const cliffFloor = floorMode === 'nextLowerCliffTier' ? requiredCliffFloor(context, compiled, anchorC, anchorR) : null;
    if (floorMode === 'nextLowerCliffTier' && !cliffFloor) return { tier: 0, spread: 0, mismatch: Infinity, groupId: null, error: 'no required cliff face available to derive locale floor' };
    if (cliffFloor?.error) return { tier: 0, spread: 0, mismatch: Infinity, groupId: null, error: cliffFloor.error };
    if (!tiers.length) return { tier: cliffFloor?.tier || 0, spread: 0, mismatch: 0, groupId: null, source: cliffFloor?.source || 'footprint' };
    const counts = new Map(); // Rounded tier frequency selects a stable floor in mildly noisy/ramp-adjacent terrain.
    for (const tier of tiers) {
      const key = Number(tier.toFixed(2));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let floorTier = tiers[0]; // Most common host tier becomes locale floor unless the placement explicitly derives it from the low side of a required cliff.
    let floorCount = -1;
    for (const [tier, count] of counts) if (count > floorCount) { floorCount = count; floorTier = Number(tier); }
    if (cliffFloor) floorTier = Number(cliffFloor.tier);
    const minTier = Math.min(...tiers); // Tier spread enforces legacy-like flatness on the ordinary footprint when requested.
    const maxTier = Math.max(...tiers);
    const mismatch = Math.max(...tiers.map(tier => Math.abs(tier - floorTier))); // Derived floors must actually be occupied by the ordinary locale footprint, not merely sit below an unrelated shelf.
    let groupId = null; // Matching plateau group lets a raised-floor cave carve into a higher mesa while staying on its lower shelf.
    for (const cell of sample) {
      const worldC = anchorC + cell.c;
      const worldR = anchorR + cell.r;
      const tile = tileRecord(context.root, worldC, worldR);
      if (tile?.plateau && Math.abs(tileTier(context, worldC, worldR) - floorTier) <= 0.05) { groupId = tile.plateau; break; }
    }
    return { tier: floorTier, spread: maxTier - minTier, mismatch, groupId, source: cliffFloor?.source || 'footprint' };
  }
'''
if old in s:
    s = s.replace(old, new, 1)
elif 'function requiredCliffFloor(' not in s:
    raise SystemExit('chooseLocaleFloor patch target missing')
old_eval = '''    const floor = chooseLocaleFloor(context, compiled, anchorC, anchorR); // Candidate floor tier is needed before relative-height probes can be evaluated.
    if (placement.requiresFlatGround !== false && floor.spread > 0.05) return { ok: false, reason: `ordinary footprint not flat (spread ${floor.spread.toFixed(2)})`, floorTier: floor.tier };
'''
new_eval = '''    const floor = chooseLocaleFloor(context, compiled, anchorC, anchorR); // Candidate floor tier is needed before relative-height probes can be evaluated.
    if (floor.error) return { ok: false, reason: floor.error, floorTier: floor.tier };
    if (placement.requiresFlatGround !== false && floor.spread > 0.05) return { ok: false, reason: `ordinary footprint not flat (spread ${floor.spread.toFixed(2)})`, floorTier: floor.tier };
    if (placement.floorMode === 'nextLowerCliffTier' && floor.mismatch > 0.05) return { ok: false, reason: `ordinary footprint is not on the cliff's next lower tier (mismatch ${floor.mismatch.toFixed(2)})`, floorTier: floor.tier };
'''
if old_eval in s:
    s = s.replace(old_eval, new_eval, 1)
elif "ordinary footprint is not on the cliff's next lower tier" not in s:
    raise SystemExit('evaluate floor patch target missing')
p.write_text(s)

# 2) Canonical Banubu exterior: choose the next lower adjacent tier from its
# required internal cliff; remove exterior NPC because Banubu belongs in a
# future cave interior. The connector remains the future interior handoff.
p = Path('docs/config/locales/locale_banubu_shrine.json')
loc = json.loads(p.read_text())
loc['placement']['floorMode'] = 'nextLowerCliffTier'
# One high-side internal cliff probe is sufficient; floorMode derives its adjacent low tier.
loc.get('terrainAnchors', {}).pop('4,4', None)
loc.get('placement', {}).get('terrainAnchors', {}).pop('4,4', None)
loc['npcAnchors'] = []
note = "The exterior entrance floor is derived from the immediately adjacent LOW side of the required internal cliff, so it may be ground or the top of a lower mesa. The higher rear plateau is carved around the entrance. Banubu himself belongs in a future interior map; this exterior keeps only the entrance connector."
loc['placement']['notes'] = note
p.write_text(json.dumps(loc, indent=2) + '\n')

# 3) Locale Editor: expose floor mode, preserve object.visual metadata, and
# avoid warning that cave-exterior shrines must contain their eventual interior NPC.
p = Path('docs/tools/locale-editor/index.html')
s = p.read_text()
ui_old = '''          <label class="chk" style="margin-top:6px"><input type="checkbox" id="locFlatGround" checked> Requires flat ground</label>
          <label class="chk"><input type="checkbox" id="locSameSector"> Same one-of-nine sector as the zone's entry gate</label>
'''
ui_new = '''          <div style="margin-top:6px"><label>Locale floor source</label>
            <select id="locFloorMode">
              <option value="footprint">Use the footprint's host tier</option>
              <option value="nextLowerCliffTier">Use the next lower tier beside a required cliff</option>
            </select>
            <p class="muted" style="margin-top:4px">“Next lower tier” follows the cliff geometry itself: a 1→0 cliff gives ground level; a 7→4 cliff gives the tier-4 mesa top.</p>
          </div>
          <label class="chk" style="margin-top:6px"><input type="checkbox" id="locFlatGround" checked> Requires flat ground</label>
          <label class="chk"><input type="checkbox" id="locSameSector"> Same one-of-nine sector as the zone's entry gate</label>
'''
if ui_old in s:
    s = s.replace(ui_old, ui_new, 1)
elif 'id="locFloorMode"' not in s:
    raise SystemExit('floor mode UI target missing')
s = s.replace("placement: { mode: 'fixed', maxInstances: 1, allowedZones: [], clearanceTiles: 2, requiresFlatGround: true, minDistanceFromEntry: 0, sameSectorAsEntry: false, alwaysVisibleOnMap: false, groundOnly: false, notes: '' },",
              "placement: { mode: 'fixed', maxInstances: 1, allowedZones: [], clearanceTiles: 2, requiresFlatGround: true, floorMode: 'footprint', minDistanceFromEntry: 0, sameSectorAsEntry: false, alwaysVisibleOnMap: false, groundOnly: false, notes: '' },")
s = s.replace("placement: Object.assign({ mode: 'fixed', maxInstances: 1, allowedZones: [], clearanceTiles: 2, requiresFlatGround: true, minDistanceFromEntry: 0, sameSectorAsEntry: false, alwaysVisibleOnMap: false, groundOnly: false, notes: '' }, raw.placement || {}),",
              "placement: Object.assign({ mode: 'fixed', maxInstances: 1, allowedZones: [], clearanceTiles: 2, requiresFlatGround: true, floorMode: 'footprint', minDistanceFromEntry: 0, sameSectorAsEntry: false, alwaysVisibleOnMap: false, groundOnly: false, notes: '' }, raw.placement || {}),")
obj_line = "    const obj = { id: o.id || uid('obj'), kind: o.kind || 'decor', key: o.key || 'bench', label: o.label || '', col: o.col|0, row: o.row|0, w: Math.max(1, o.w|0 || 1), h: Math.max(1, o.h|0 || 1), rot: o.rot || 0 };"
obj_new = obj_line + "\n    if (o.visual && typeof o.visual === 'object') obj.visual = JSON.parse(JSON.stringify(o.visual)); // Preserve authored renderer/scale/facing metadata such as cave_small visual overrides."
if obj_line in s and 'Preserve authored renderer/scale/facing metadata' not in s:
    s = s.replace(obj_line, obj_new, 1)
render_old = "  $('locFlatGround').checked = m.placement.requiresFlatGround;"
render_new = "  $('locFlatGround').checked = m.placement.requiresFlatGround;\n  $('locFloorMode').value = m.placement.floorMode === 'nextLowerCliffTier' ? 'nextLowerCliffTier' : 'footprint';"
if render_old in s and "$('locFloorMode').value" not in s:
    s = s.replace(render_old, render_new, 1)
apply_old = "  m.placement.requiresFlatGround = $('locFlatGround').checked;"
apply_new = "  m.placement.requiresFlatGround = $('locFlatGround').checked;\n  m.placement.floorMode = $('locFloorMode').value === 'nextLowerCliffTier' ? 'nextLowerCliffTier' : 'footprint';"
if apply_old in s and "m.placement.floorMode = $('locFloorMode')" not in s:
    s = s.replace(apply_old, apply_new, 1)
validation_old = "  if ((m.category === 'dwelling' || m.category === 'great_fey_shrine') && !m.npcAnchors.length) {\n    issues.push({ level:'warning', msg:`No NPC anchors placed — a ${m.category === 'dwelling' ? 'dwelling' : 'shrine'} usually anchors at least one named character.` });\n  }"
validation_new = "  const caveExterior = m.objects.some(object => object.key === 'cave_small');\n  if ((m.category === 'dwelling' || m.category === 'great_fey_shrine') && !m.npcAnchors.length && !(m.category === 'great_fey_shrine' && caveExterior)) {\n    issues.push({ level:'warning', msg:`No NPC anchors placed — a ${m.category === 'dwelling' ? 'dwelling' : 'shrine'} usually anchors at least one named character.` });\n  }\n  if (m.placement.floorMode === 'nextLowerCliffTier' && !Object.values(m.terrainAnchors || m.placement.terrainAnchors || {}).some(rule => rule?.strength === 'required' && (rule?.terrain === 'plateauCliff' || rule?.terrain === 'boundaryCliff'))) {\n    issues.push({ level:'error', msg:'Floor source is “next lower cliff tier” but there is no required cliff probe to derive it from.' });\n  }"
if validation_old in s:
    s = s.replace(validation_old, validation_new, 1)
elif 'const caveExterior =' not in s:
    raise SystemExit('validation patch target missing')
p.write_text(s)

# 4) Regressions: canonical data, no exterior NPC, ground-or-lower-mesa behavior.
p = Path('scripts/test-banubu-cave-locale.js')
s = p.read_text()
s = s.replace("assert.strictEqual(locale.placement?.requiresFlatGround, true, 'the exposed cave floor/approach must remain flat');",
              "assert.strictEqual(locale.placement?.requiresFlatGround, true, 'the exposed cave floor/approach must remain flat');\nassert.strictEqual(locale.placement?.floorMode, 'nextLowerCliffTier', 'Banubu exterior floor must derive from the adjacent low side of its selected internal cliff');")
low_block = '''const lowCliff = anchors['4,4'];
assert(lowCliff, 'Banubu Cave needs an explicit low-side cliff probe at the cave mouth');
assert.strictEqual(lowCliff.terrain, 'plateauCliff');
assert.strictEqual(lowCliff.facing, 'north');
assert.strictEqual(lowCliff.height?.mode, 'relativeRange');
assert.strictEqual(lowCliff.height?.min, 0);
assert.strictEqual(lowCliff.height?.max, 0, 'mouth cliff probe must be exactly on the locale floor, selecting the low side of the cliff');
'''
s = s.replace(low_block, '')
s = s.replace("assert.strictEqual(cliffFit.floorTier, 0, 'synthetic cave floor should remain on the lower tier');",
              "assert.strictEqual(cliffFit.floorTier, 0, 'a cliff whose adjacent low side is ground must place the cave at ground level');")
# Insert stacked-mesa fixture after flat rejection.
stack_marker = "assert.strictEqual(flatFit.ok, false, 'Banubu Cave must reject flat terrain with no higher plateau mass');\n"
stack_code = stack_marker + '''\nfunction syntheticStackedMesaWorkspace() {
  const cols = 40, rows = 40;
  const root = { id: 'root', cols, rows, tiles: {}, generatedFrom: { note: 'Flattened after 2x tile-density expansion.' } };
  const workspace = { maps: [root], plateauGroups: [{ id: 'low', elevation: 2 }, { id: 'high', elevation: 5 }], localeInstances: [] };
  const low = { id: 'plateau_low', isSubmap: true, plateauGroupId: 'low', cols, rows: 20, anchorC: 0, anchorR: 0, tiles: {} };
  const high = { id: 'plateau_high', isSubmap: true, plateauGroupId: 'high', cols, rows: 20, anchorC: 0, anchorR: 20, tiles: {} };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const highSide = r >= 20;
    root.tiles[`${c},${r}`] = { type: 'grass', crop: '', plateau: highSide ? 'high' : 'low' };
    (highSide ? high : low).tiles[`${c},${highSide ? r - 20 : r}`] = { type: 'grass', crop: '' };
  }
  workspace.maps.push(low, high);
  return workspace;
}
const stackedFit = terrainPlacement.evaluateCandidateForTest(syntheticStackedMesaWorkspace(), locale, 4, 10, { scale: 2, seed: 'banubu-cave-stacked-test' });
assert.strictEqual(stackedFit.ok, true, `Banubu Cave must fit a taller mesa behind a lower mesa: ${stackedFit.reason || 'unknown rejection'}`);
assert.strictEqual(stackedFit.floorTier, 2, 'a 5→2 cliff must place the cave on the adjacent tier-2 lower mesa, not force ground or tier 4');
'''
if stack_marker in s and 'syntheticStackedMesaWorkspace' not in s:
    s = s.replace(stack_marker, stack_code, 1)
s = s.replace("const npc = (locale.npcAnchors || []).find(anchor => anchor.npcId === 'banubu');\nassert(npc, 'Banubu must remain anchored inside his cave locale');\n",
              "assert(!(locale.npcAnchors || []).some(anchor => anchor.npcId === 'banubu'), 'Banubu belongs in a future cave interior, not the exterior entrance locale');\nassert((locale.connectors || []).some(connector => connector.label === \"Banubu's Cave entrance\"), 'exterior entrance connector must remain for the future interior handoff');\n")
p.write_text(s)

p = Path('scripts/test-banubu-wilderness-lab-generation.js')
s = p.read_text()
old_probe = '''const lowSideCliffProbes = internalCliffProbes.filter(probe => probe.rule?.height?.min === 0 && probe.rule?.height?.max === 0);
const highSideCliffProbes = internalCliffProbes.filter(probe => (probe.rule?.height?.min ?? -Infinity) >= 1);
assert(lowSideCliffProbes.length === 2, 'Banubu mouth Δ0 cliff cell must expand to a 2-tile low-side strip');
assert(highSideCliffProbes.length === 2, 'Banubu embedded cliff cell must expand to a 2-tile high-side strip');
assert(lowSideCliffProbes.every(probe => Math.abs(probe.hostTier - diagnostic.selected.floorTier) < 0.001), 'Banubu mouth must be on the local low side at the locale floor tier');
assert(highSideCliffProbes.every(probe => probe.hostTier >= diagnostic.selected.floorTier + 1), 'Banubu rear cliff must rise at least one tier above the locale floor');

assert.strictEqual(internalCliffProbes.length, 4, "paired low/high authored cliff cells must expand to two 2-tile cliff-face strips at 2x density");
'''
new_probe = '''const highSideCliffProbes = internalCliffProbes.filter(probe => (probe.rule?.height?.min ?? -Infinity) >= 1);
assert(highSideCliffProbes.length === 2, 'Banubu authored high-side cliff cell must expand to a 2-tile cliff-face strip');
assert(highSideCliffProbes.every(probe => probe.hostTier >= diagnostic.selected.floorTier + 1), 'Banubu rear cliff must rise above the derived lower-side locale floor');

assert.strictEqual(internalCliffProbes.length, 2, "one high-side authored cliff cell must expand to exactly a 2-tile cliff-face strip at 2x density");
'''
if old_probe in s:
    s = s.replace(old_probe, new_probe, 1)
elif 'highSideCliffProbes.length === 2' not in s:
    raise SystemExit('real generator cliff assertion patch target missing')
s = s.replace("assert((instance.npcAnchors || []).some(anchor => anchor.npcId === 'banubu'), 'placed Banubu locale must carry Banubu into runtime data.');",
              "assert(!(instance.npcAnchors || []).some(anchor => anchor.npcId === 'banubu'), 'Banubu exterior locale must not spawn Banubu; he belongs in the future interior.');")
# Verify the cell immediately outward from each north-facing high cliff is exactly the derived floor tier.
needle = "const root = (workspace.maps || []).find(map => map && !map.isSubmap);\n"
insert = needle + "const plateauTier = new Map((workspace.plateauGroups || []).map(group => [group.id, Number(group.elevation) || 0]));\nconst tierAt = (c, r) => { const tile = root?.tiles?.[`${c},${r}`]; if (!tile) return 0; if (Number.isFinite(Number(tile.rampElevation))) return Number(tile.rampElevation); return plateauTier.get(tile.plateau) || 0; };\nassert(highSideCliffProbes.every(probe => Math.abs(tierAt(probe.c, probe.r - 1) - diagnostic.selected.floorTier) < 0.001), 'the north-adjacent low side of Banubu\'s chosen cliff must exactly equal the derived locale floor tier');\n"
if needle in s and 'the north-adjacent low side' not in s:
    s = s.replace(needle, insert, 1)
p.write_text(s)
