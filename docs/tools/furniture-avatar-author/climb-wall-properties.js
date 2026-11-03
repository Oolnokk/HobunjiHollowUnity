// Furniture Author: cell elevation (auto-measured, overridable) and climbable wall tiles.
//
//  * `elevation` is attached to EVERY export, re-measured from the preview scene's bounding
//    box each time (mode "auto"), so generators can snap pieces to the cubic cell grid.
//    "Manual" lets the author override width / depth / height in cells field by field.
//  * `climbWall` (optional) marks the piece as a climbable wall tile: one cell wide, full
//    cell tall, art authored to look continuous beside copies of itself, with end-closing
//    variants for the outermost tiles of a run. See js/climb-wall-tiles.js.
(() => {
  'use strict';
  const FE = window.FurnitureElevation, CWT = window.ClimbWallTiles, CS = window.ClimbSurfaces;
  if (!FE || !CWT || typeof state !== 'object') return;

  const el = id => document.getElementById(id);
  const host = document.getElementById('sidebar-scroll') || document.querySelector('aside');
  const section = document.createElement('div');
  section.className = 'section';
  section.style.cssText = '--sec:#f59e0b;--secBg:rgba(245,158,11,.08)';
  const styleOptions = (CS?.listStyles?.() || [{ id: 'default', label: 'default' }]).map(s => `<option value="${s.id}">${s.label}</option>`).join('');
  section.innerHTML = `<div class="sect-head"><b>Cells &amp; Climbable Wall</b><span class="sect-tag">3D grid</span></div>
    <p class="muted">One cell = 1 × 1 × 1 world units. The measurement follows the preview and is saved with every export.</p>
    <div id="cwMeasure" class="pill">Not measured</div>
    <div class="g2" style="margin-top:6px"><div><label>Cell size source</label><select id="cwMode"><option value="auto">Auto (measured)</option><option value="manual">Manual override</option></select></div><div><label>&nbsp;</label><button id="cwRemeasure" type="button">Measure now</button></div></div>
    <div id="cwManualFields" style="display:none;margin-top:6px"><label>Override cells W / D / H (blank = measured)</label><div class="g3"><input id="cwManW" type="number" min="1" step="1"><input id="cwManD" type="number" min="1" step="1"><input id="cwManH" type="number" min="1" step="1"></div></div>
    <div id="cwEffective" class="pill" style="margin-top:6px">—</div>
    <fieldset style="margin-top:10px"><legend>Climbable wall tile</legend>
      <label class="chk"><input id="cwEnabled" type="checkbox"> This piece is a climbable wall tile</label>
      <div id="cwFields" style="display:none">
        <p class="muted">Full tile height, one cell wide. Hold spacing and edges must continue across neighbouring tiles. Make a Middle piece plus Left / Right end pieces and a Single; list them on the Middle piece.</p>
        <div class="g2"><div><label>Look / feel</label><select id="cwStyle">${styleOptions}</select></div><div><label>Role</label><select id="cwRole"><option value="mid">Middle (repeats)</option><option value="endLeft">Left end</option><option value="endRight">Right end</option><option value="single">Single (both ends)</option></select></div></div>
        <div class="g2" style="margin-top:6px"><div><label>Climb face points</label><select id="cwSide"><option value="+z">+Z (front)</option><option value="-z">−Z (back)</option><option value="+x">+X</option><option value="-x">−X</option></select></div><div><label>Face plane offset (cells)</label><input id="cwOffset" type="number" step=".01"></div></div>
        <button id="cwFaceFromGeometry" type="button" style="margin-top:6px;width:100%">Set face plane from the selected part's front (or the piece)</button>
        <div id="cwVariants" style="display:none;margin-top:8px">
          <label>Left end piece key</label><input id="cwVarLeft" placeholder="e.g. ruinClimbHoldsEndLeft">
          <label style="margin-top:5px">Right end piece key</label><input id="cwVarRight" placeholder="e.g. ruinClimbHoldsEndRight">
          <label style="margin-top:5px">Single piece key</label><input id="cwVarSingle" placeholder="e.g. ruinClimbHoldsSingle">
          <button id="cwCheckSet" type="button" style="margin-top:6px;width:100%">Check this set</button>
        </div>
        <div id="cwStatus" class="pill" style="margin-top:6px">—</div>
        <div id="cwSetStatus" class="pill" style="margin-top:6px;display:none"></div>
      </div>
    </fieldset>`;
  host.appendChild(section);

  function measureNow() {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return null;
    return FE.measureBounds(box); // The footprint is centred on the origin and y = 0 is the floor, matching the cell grid.
  }

  function ensureElevation() {
    if (!state.elevation) state.elevation = { version: FE.VERSION, mode: 'auto', measured: null, manual: {} };
    return state.elevation;
  }
  function remeasure() {
    const e = ensureElevation(), m = measureNow();
    if (m) e.measured = m;
    return m;
  }
  // Extent of an object's bounds along a face normal: { back, front } in furniture-local units.
  function extentAlong(box, n) {
    return n.x ? (n.x > 0 ? { back: box.min.x, front: box.max.x } : { back: -box.max.x, front: -box.min.x })
      : (n.z > 0 ? { back: box.min.z, front: box.max.z } : { back: -box.max.z, front: -box.min.z });
  }
  // The climb plane is where hands are: it may sit behind protruding holds, but it must lie within the piece's depth.
  const tileProblems = () => {
    const wall = state.climbWall;
    if (!wall?.enabled) return [];
    const problems = FE.checkCells(state.elevation, { cellsW: 1, cellsH: 1 }).map(p => `Tile size: ${p}`);
    const box = new THREE.Box3().setFromObject(root), offset = num(wall.face?.offset, 0.5);
    if (!box.isEmpty()) {
      const { back, front } = extentAlong(box, CWT.SIDES[wall.face?.side] || CWT.SIDES['+z']);
      if (offset < back - 0.06 || offset > front + 0.06) problems.push(`Face plane ${offset.toFixed(2)} is outside the piece (${back.toFixed(2)} … ${front.toFixed(2)}), so players would hang in empty air or inside it`);
    }
    return problems;
  };
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // Sets the controls from state. Only on load and on structural toggles: never while the user is typing.
  function syncFields() {
    const e = ensureElevation(), wall = state.climbWall;
    el('cwMode').value = e.mode;
    el('cwManW').value = e.manual?.cellsW ?? ''; el('cwManD').value = e.manual?.cellsD ?? ''; el('cwManH').value = e.manual?.cellsH ?? '';
    el('cwEnabled').checked = !!wall?.enabled;
    if (wall?.enabled) {
      el('cwStyle').value = wall.style || 'default'; el('cwRole').value = wall.role || 'mid';
      el('cwSide').value = wall.face?.side || '+z'; el('cwOffset').value = num(wall.face?.offset, 0.5);
      el('cwVarLeft').value = wall.variants?.endLeft || ''; el('cwVarRight').value = wall.variants?.endRight || ''; el('cwVarSingle').value = wall.variants?.single || '';
    }
    refreshReadouts();
  }
  // Readouts and visibility only; compares before writing so the periodic refresh causes no DOM churn.
  const setText = (id, text) => { const node = el(id); if (node.textContent !== text) node.textContent = text; };
  const setShown = (id, shown) => { const node = el(id), want = shown ? '' : 'none'; if (node.style.display !== want) node.style.display = want; };
  function refreshReadouts() {
    const e = ensureElevation(), m = e.measured, eff = FE.effective(e), wall = state.climbWall;
    setShown('cwManualFields', e.mode === 'manual');
    setText('cwMeasure', m ? `Measured ${m.sizeX.toFixed(2)} × ${m.sizeZ.toFixed(2)} wide/deep, ${m.sizeY.toFixed(2)} tall (y ${m.minY.toFixed(2)}…${m.maxY.toFixed(2)}) → ${m.cellsW} × ${m.cellsD} × ${m.cellsH} cells` : 'Not measured (add parts)');
    setText('cwEffective', eff.source === 'none' ? 'No cell size yet' : `Cell size used: ${eff.cellsW} × ${eff.cellsD} × ${eff.cellsH} (${eff.source})`);
    setShown('cwFields', !!wall?.enabled);
    if (wall?.enabled) {
      setShown('cwVariants', (wall.role || 'mid') === 'mid');
      const problems = tileProblems();
      setText('cwStatus', problems.length ? `⚠ ${problems.join(' · ')}` : '✓ Tile size and face plane look right');
    }
  }

  function readClimbWall() {
    const wall = state.climbWall || (state.climbWall = { version: CWT.VERSION, enabled: true, style: 'default', face: { side: '+z', offset: 0.5 }, role: 'mid', variants: {} });
    wall.enabled = true; wall.style = el('cwStyle').value; wall.role = el('cwRole').value;
    wall.face = { side: el('cwSide').value, offset: num(el('cwOffset').value, 0.5) };
    wall.variants = {}; for (const [k, id] of [['endLeft', 'cwVarLeft'], ['endRight', 'cwVarRight'], ['single', 'cwVarSingle']]) if (el(id).value.trim()) wall.variants[k] = el(id).value.trim();
  }

  el('cwRemeasure').onclick = () => { remeasure(); refreshReadouts(); };
  el('cwMode').onchange = () => { ensureElevation().mode = el('cwMode').value; refreshReadouts(); };
  for (const [id, key] of [['cwManW', 'cellsW'], ['cwManD', 'cellsD'], ['cwManH', 'cellsH']]) {
    el(id).oninput = () => { const e = ensureElevation(); e.manual = e.manual || {}; const v = Math.round(Number(el(id).value)); if (Number.isFinite(v) && v >= 1) e.manual[key] = v; else delete e.manual[key]; refreshReadouts(); };
  }
  el('cwEnabled').onchange = () => {
    if (el('cwEnabled').checked) { state.climbWall = state.climbWall || { version: CWT.VERSION, enabled: true, style: 'default', face: { side: '+z', offset: 0.5 }, role: 'mid', variants: {} }; state.climbWall.enabled = true; remeasure(); }
    else if (state.climbWall) state.climbWall.enabled = false;
    syncFields();
  };
  for (const id of ['cwStyle', 'cwRole', 'cwSide', 'cwOffset', 'cwVarLeft', 'cwVarRight', 'cwVarSingle']) el(id).addEventListener('input', () => { readClimbWall(); refreshReadouts(); });
  el('cwFaceFromGeometry').onclick = () => {
    const selected = state.selectedType === 'part' && typeof meshes !== 'undefined' ? meshes.get(state.selectedId) : null;
    const target = selected || root;
    target.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(target); if (box.isEmpty()) return;
    el('cwOffset').value = extentAlong(box, CWT.SIDES[el('cwSide').value]).front.toFixed(3);
    readClimbWall(); refreshReadouts();
    log(`Climb face plane set from the ${selected ? 'selected part' : 'whole piece'}'s front edge.`);
  };
  el('cwCheckSet').onclick = async () => {
    readClimbWall();
    const keys = { mid: state.id || '(this piece)' }, blocks = {}, base = '../../config/furniture-authored/';
    blocks[keys.mid] = CWT.normalize(state.climbWall);
    const problems = [];
    for (const key of Object.values(state.climbWall.variants || {})) {
      try { const r = await fetch(`${base}${encodeURIComponent(key)}.json`, { cache: 'no-store' }); blocks[key] = r.ok ? (await r.json()).climbWall : null; if (!r.ok) problems.push(`${key}: not found in config/furniture-authored`); }
      catch (error) { problems.push(`${key}: ${error.message || error}`); }
    }
    problems.push(...CWT.validateSet(keys.mid, key => blocks[key]));
    el('cwSetStatus').style.display = ''; el('cwSetStatus').textContent = problems.length ? `⚠ Set: ${problems.join(' · ')}` : '✓ Set is consistent: roles, style and face plane match';
    log(problems.length ? `Climb wall set: ${problems.length} issue(s).` : 'Climb wall set is consistent.', problems.length ? 'warn' : 'info');
  };

  // Exports always carry fresh elevation metadata; the climb block only when enabled.
  const originalExportData = exportData;
  exportData = function exportFurnitureWithCells() {
    const data = originalExportData(), e = ensureElevation();
    remeasure(); // Always store the fresh measurement; manual overrides only win at read time (FurnitureElevation.effective).
    if (e.measured || Object.keys(e.manual || {}).length) data.elevation = FE.normalize(e);
    if (state.climbWall?.enabled) data.climbWall = CWT.normalize(state.climbWall);
    return data;
  };
  const originalLoadData = loadData;
  loadData = function loadFurnitureWithCells(data) {
    originalLoadData(data);
    state.elevation = data?.elevation ? FE.normalize(data.elevation) : null;
    state.climbWall = data?.climbWall && typeof data.climbWall === 'object' ? { ...data.climbWall, enabled: data.climbWall.enabled !== false } : null;
    ensureElevation(); remeasure(); syncFields();
  };

  // The preview changes constantly while authoring; keep the readout fresh without measuring every frame.
  setInterval(() => { if (document.hidden) return; remeasure(); refreshReadouts(); }, 1500);
  remeasure(); syncFields();
})();
