import json
from pathlib import Path

# Banubu: pair a low-side Δ0 cliff probe with the existing high-side Δ>=1 probe.
p = Path('docs/config/locales/locale_banubu_shrine.json')
loc = json.loads(p.read_text())
for key in ('3,3', '4,3', '5,3'):
    loc['terrainAnchors'][key]['terrain'] = 'free'
    loc['placement']['terrainAnchors'][key]['terrain'] = 'free'
low_probe = {
    'terrain': 'plateauCliff',
    'strength': 'required',
    'weight': 1,
    'facing': 'north',
    'height': {'mode': 'relativeRange', 'min': 0, 'max': 0},
}
loc['terrainAnchors']['4,4'] = low_probe
loc['placement']['terrainAnchors']['4,4'] = json.loads(json.dumps(low_probe))
note = 'The mouth cell is the LOW side of the internal cliff at Δ0, while the embedded cell immediately behind it is the HIGH side at Δ>=+1. This keeps the cave at the local cliff base even when the whole region is globally elevated.'
old_note = str(loc['placement'].get('notes') or '')
if note not in old_note:
    loc['placement']['notes'] = old_note + (' ' if old_note else '') + note
p.write_text(json.dumps(loc, indent=2) + '\n')

# Update authored/runtime regression for local low/high semantics.
p = Path('scripts/test-banubu-cave-locale.js')
s = p.read_text()
old = """const groundApproach = Object.values(anchors).filter(rule => rule.terrain === 'ground' && rule.strength === 'required');
assert(groundApproach.length >= 3, 'Banubu Cave needs a required true-ground approach so the cave floor cannot land on a raised shelf');
for (const key of ['3,3', '4,3', '5,3']) {
  assert.strictEqual(anchors[key]?.terrain, 'ground', `Banubu approach ${key} must require tier-0 ground`);
  assert.strictEqual(locale.placement?.terrainAnchors?.[key]?.terrain, 'ground', `persisted Banubu approach ${key} must mirror tier-0 ground requirement`);
}
"""
new = """const freeApproach = ['3,3', '4,3', '5,3'].map(key => anchors[key]);
assert(freeApproach.every(rule => rule?.terrain === 'free' && rule?.strength === 'required'), 'Banubu Cave needs an open approach before the cliff mouth');
const lowCliff = anchors['4,4'];
assert(lowCliff, 'Banubu Cave needs an explicit low-side cliff probe at the cave mouth');
assert.strictEqual(lowCliff.terrain, 'plateauCliff');
assert.strictEqual(lowCliff.facing, 'north');
assert.strictEqual(lowCliff.height?.mode, 'relativeRange');
assert.strictEqual(lowCliff.height?.min, 0);
assert.strictEqual(lowCliff.height?.max, 0, 'mouth cliff probe must be exactly on the locale floor, selecting the low side of the cliff');
"""
if old in s:
    s = s.replace(old, new, 1)
elif "const lowCliff = anchors['4,4']" not in s:
    raise SystemExit('Banubu authored test patch target missing')
p.write_text(s)

# Update real Northern Cliffs regression.
p = Path('scripts/test-banubu-wilderness-lab-generation.js')
s = p.read_text()
s = s.replace("assert.strictEqual(diagnostic.selected?.floorTier, 0, 'Banubu Cave must place at the true ground-level base of a cliff, never on a raised shelf');\nassert.strictEqual(instance.floorTier, 0, 'runtime Banubu locale floor must remain tier 0');\n", '')
marker = "const internalCliffProbes = (diagnostic.selected?.probes || []).filter(probe => probe.rule?.terrain === 'plateauCliff');"
if marker in s and 'lowSideCliffProbes' not in s:
    extra = marker + """
const lowSideCliffProbes = internalCliffProbes.filter(probe => probe.rule?.height?.min === 0 && probe.rule?.height?.max === 0);
const highSideCliffProbes = internalCliffProbes.filter(probe => (probe.rule?.height?.min ?? -Infinity) >= 1);
assert(lowSideCliffProbes.length === 2, 'Banubu mouth Δ0 cliff cell must expand to a 2-tile low-side strip');
assert(highSideCliffProbes.length === 2, 'Banubu embedded cliff cell must expand to a 2-tile high-side strip');
assert(lowSideCliffProbes.every(probe => Math.abs(probe.hostTier - diagnostic.selected.floorTier) < 0.001), 'Banubu mouth must be on the local low side at the locale floor tier');
assert(highSideCliffProbes.every(probe => probe.hostTier >= diagnostic.selected.floorTier + 1), 'Banubu rear cliff must rise at least one tier above the locale floor');
"""
    s = s.replace(marker, extra, 1)
s = s.replace(
    "assert.strictEqual(internalCliffProbes.length, 2, \"one north-facing authored cliff cell must expand to exactly a 2-tile cliff-face strip at the generator's 2x density\");",
    "assert.strictEqual(internalCliffProbes.length, 4, \"paired low/high authored cliff cells must expand to two 2-tile cliff-face strips at 2x density\");",
)
p.write_text(s)

# Locale Editor: rotation control + drag-to-translate objects/NPCs/connectors.
p = Path('docs/tools/locale-editor/index.html')
s = p.read_text()

old = "let painting = false;\nlet paintErase = false;"
new = "let painting = false;\nlet paintErase = false;\nlet markerDrag = null; // Active direct-manipulation drag for an object/NPC/connector; committed once on pointerup."
if old in s and 'let markerDrag = null;' not in s:
    s = s.replace(old, new, 1)

draw_old = """    if (cs >= 14) {
      const info = OBJECT_PALETTE.find(o => o.key === obj.key);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(cs*0.6)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(info?.icon || '❓', x+w/2, y+h/2);
    }
"""
draw_new = """    if (cs >= 14) {
      const info = OBJECT_PALETTE.find(o => o.key === obj.key);
      const cx = x+w/2, cy = y+h/2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((Number(obj.rot) || 0) * Math.PI / 180);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(cs*0.6)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(info?.icon || '❓', 0, 0);
      ctx.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,.8)';
      ctx.lineWidth = Math.max(1, cs * 0.06);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -Math.min(w,h)*0.34); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -Math.min(w,h)*0.34); ctx.lineTo(-cs*.11, -Math.min(w,h)*0.22); ctx.lineTo(cs*.11, -Math.min(w,h)*0.22); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
"""
if draw_old in s:
    s = s.replace(draw_old, draw_new, 1)
elif 'ctx.rotate((Number(obj.rot) || 0)' not in s:
    raise SystemExit('object draw block target missing')

helpers = """function beginMarkerDrag(type, item, c, r, pointerId) {
  selected = { type, id: item.id };
  markerDrag = {
    type, id: item.id, pointerId,
    offsetC: type === 'object' ? c - item.col : 0,
    offsetR: type === 'object' ? r - item.row : 0,
    moved: false
  };
  renderInspector(); draw();
}

function tryBeginMarkerDrag(c, r, pointerId) {
  const m = activeLocale();
  if (!m) return false;
  if (mode === 'object') {
    const hit = [...m.objects].reverse().find(o => c >= o.col && c < o.col + o.w && r >= o.row && r < o.row + o.h);
    if (hit) { beginMarkerDrag('object', hit, c, r, pointerId); return true; }
  } else if (mode === 'npc') {
    const hit = [...m.npcAnchors].reverse().find(n => n.col === c && n.row === r);
    if (hit) { beginMarkerDrag('npc', hit, c, r, pointerId); return true; }
  } else if (mode === 'connector') {
    const hit = [...m.connectors].reverse().find(conn => conn.col === c && conn.row === r);
    if (hit) { beginMarkerDrag('connector', hit, c, r, pointerId); return true; }
  }
  return false;
}

function updateMarkerDrag(c, r) {
  const m = activeLocale();
  if (!m || !markerDrag) return false;
  let item = null;
  if (markerDrag.type === 'object') item = m.objects.find(x => x.id === markerDrag.id);
  else if (markerDrag.type === 'npc') item = m.npcAnchors.find(x => x.id === markerDrag.id);
  else if (markerDrag.type === 'connector') item = m.connectors.find(x => x.id === markerDrag.id);
  if (!item) return false;
  let col = c - markerDrag.offsetC, row = r - markerDrag.offsetR;
  if (markerDrag.type === 'object') {
    col = clamp(col, 0, Math.max(0, m.cols - item.w));
    row = clamp(row, 0, Math.max(0, m.rows - item.h));
  } else {
    col = clamp(col, 0, m.cols - 1);
    row = clamp(row, 0, m.rows - 1);
  }
  col = Math.round(col); row = Math.round(row);
  if (item.col === col && item.row === row) return true;
  item.col = col; item.row = row; markerDrag.moved = true;
  const colInput = $('insCol'), rowInput = $('insRow');
  if (colInput) colInput.value = col;
  if (rowInput) rowInput.value = row;
  draw();
  return true;
}

"""
if 'function beginMarkerDrag(' not in s:
    marker = 'function finishEdit() {'
    if s.count(marker) != 1:
        raise SystemExit('finishEdit marker missing')
    s = s.replace(marker, helpers + marker, 1)

down_old = """  if (mode === 'tile') { painting = true; paintErase = false; applyTileAt(c, r, false); finishEdit(); }
  else if (mode === 'erase') { painting = true; paintErase = true; applyTileAt(c, r, true); finishEdit(); }
  else if (mode === 'object') placeOrSelectObject(c, r);
  else if (mode === 'npc') placeOrSelectNpc(c, r);
  else if (mode === 'connector') placeOrSelectConnector(c, r);
"""
down_new = """  if (mode === 'tile') { painting = true; paintErase = false; applyTileAt(c, r, false); finishEdit(); }
  else if (mode === 'erase') { painting = true; paintErase = true; applyTileAt(c, r, true); finishEdit(); }
  else if ((mode === 'object' || mode === 'npc' || mode === 'connector') && tryBeginMarkerDrag(c, r, e.pointerId)) { return; }
  else if (mode === 'object') placeOrSelectObject(c, r);
  else if (mode === 'npc') placeOrSelectNpc(c, r);
  else if (mode === 'connector') placeOrSelectConnector(c, r);
"""
if down_old in s:
    s = s.replace(down_old, down_new, 1)
elif 'tryBeginMarkerDrag(c, r, e.pointerId)' not in s:
    raise SystemExit('pointerdown mode target missing')

move_old = """  if (isPanning && panStart) {
    view.panX = panStart.panX + (e.clientX - panStart.x);
    view.panY = panStart.panY + (e.clientY - panStart.y);
    draw(); return;
  }
  if (painting && (mode === 'tile' || mode === 'erase')) { applyTileAt(c, r, paintErase); draw(); }
  else draw();
"""
move_new = """  if (isPanning && panStart) {
    view.panX = panStart.panX + (e.clientX - panStart.x);
    view.panY = panStart.panY + (e.clientY - panStart.y);
    draw(); return;
  }
  if (markerDrag && markerDrag.pointerId === e.pointerId) { updateMarkerDrag(c, r); return; }
  if (painting && (mode === 'tile' || mode === 'erase')) { applyTileAt(c, r, paintErase); draw(); }
  else draw();
"""
if move_old in s:
    s = s.replace(move_old, move_new, 1)
elif 'markerDrag && markerDrag.pointerId === e.pointerId' not in s:
    raise SystemExit('pointermove target missing')

up_old = """window.addEventListener('pointerup', () => {
  if (painting) { painting = false; finishEdit(); }
  isPanning = false; panStart = null;
});
"""
up_new = """window.addEventListener('pointerup', e => {
  if (painting) { painting = false; finishEdit(); }
  if (markerDrag && (e.pointerId == null || markerDrag.pointerId === e.pointerId)) {
    const changed = markerDrag.moved;
    markerDrag = null;
    if (changed) finishEdit(); else { renderInspector(); draw(); }
  }
  isPanning = false; panStart = null;
});
window.addEventListener('pointercancel', e => {
  if (markerDrag && markerDrag.pointerId === e.pointerId) { markerDrag = null; finishEdit(); }
  painting = false; isPanning = false; panStart = null;
});
"""
if up_old in s:
    s = s.replace(up_old, up_new, 1)
elif "window.addEventListener('pointercancel'" not in s:
    raise SystemExit('pointerup target missing')

inspector_old = """      <div class=\"g2\" style=\"margin-top:6px\"><div><label>Width</label><input id=\"insW\" type=\"number\" min=\"1\" value=\"${o.w}\"></div>
      <div><label>Height</label><input id=\"insH\" type=\"number\" min=\"1\" value=\"${o.h}\"></div></div>
"""
inspector_new = inspector_old + """      <div style=\"margin-top:6px\"><label>Rotation Y°</label><div class=\"row\" style=\"flex-wrap:nowrap\"><button class=\"sec\" id=\"insRotLeft\" type=\"button\">↺ 45°</button><input id=\"insRot\" type=\"number\" step=\"15\" value=\"${Number(o.rot)||0}\"><button class=\"sec\" id=\"insRotRight\" type=\"button\">↻ 45°</button></div></div>
      <p class=\"muted\" style=\"margin-top:4px\">Drag the object directly on the canvas to translate it.</p>
"""
if inspector_old in s:
    s = s.replace(inspector_old, inspector_new, 1)
elif 'id=\"insRot\"' not in s:
    raise SystemExit('object inspector dimension target missing')

save_old = """      o.w = Math.max(1, Math.round(Number($('insW').value)) || 1);
      o.h = Math.max(1, Math.round(Number($('insH').value)) || 1);
      if (isTent) {
"""
save_new = """      o.w = Math.max(1, Math.round(Number($('insW').value)) || 1);
      o.h = Math.max(1, Math.round(Number($('insH').value)) || 1);
      o.rot = ((Number($('insRot').value) || 0) % 360 + 360) % 360;
      if (isTent) {
"""
if save_old in s:
    s = s.replace(save_old, save_new, 1)
elif "o.rot = ((Number($('insRot').value)" not in s:
    raise SystemExit('object inspector save target missing')

listener_marker = "    $('insSave').addEventListener('click', () => {\n      o.label = $('insLabel').value.trim();"
listeners = """    const rotateBy = delta => {
      o.rot = (((Number(o.rot) || 0) + delta) % 360 + 360) % 360;
      $('insRot').value = o.rot;
      finishEdit();
    };
    $('insRotLeft').addEventListener('click', () => rotateBy(-45));
    $('insRotRight').addEventListener('click', () => rotateBy(45));
"""
if listener_marker in s and "$('insRotLeft').addEventListener" not in s:
    s = s.replace(listener_marker, listeners + listener_marker, 1)
elif "$('insRotLeft').addEventListener" not in s:
    raise SystemExit('object inspector listener target missing')

s = s.replace(
    "textContent: 'Click empty ground to place the selected object; click an existing object to select and edit it below.'",
    "textContent: 'Click empty ground to place the selected object; drag an existing object to move it. Rotation is in the Inspector.'",
)
s = s.replace(
    "textContent: 'Click ground to place an anchor; click an existing anchor to select it.'",
    "textContent: 'Click ground to place an anchor; drag an existing anchor to move it.'",
)
s = s.replace(
    "box.innerHTML = '<p class=\"muted\">Click a footprint edge cell to mark where the wilderness path network should connect in. Click an existing connector to select it.</p>';",
    "box.innerHTML = '<p class=\"muted\">Click a footprint edge cell to mark where the wilderness path network should connect in. Drag an existing connector to move it.</p>';",
)
p.write_text(s)
