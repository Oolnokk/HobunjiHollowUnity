// Furniture Author: the `rope` block. A piece with a rope block hangs a rope from itself when placed
// (see js/rope-furniture.js); the piece is the ceiling mount and the rope behaves like every other rope
// in the game (js/rope-core.js): ridden by the player in the ruin, and able to carry a burden.
(() => {
  'use strict';
  const RF = window.RopeFurniture;
  if (!RF || typeof state !== 'object') return;

  const el = id => document.getElementById(id);
  const host = document.getElementById('sidebar-scroll') || document.querySelector('aside');
  const section = document.createElement('div');
  section.className = 'section';
  section.style.cssText = '--sec:#a16207;--secBg:rgba(161,98,7,.08)';
  section.innerHTML = `<div class="sect-head"><b>Rope</b><span class="sect-tag">hangs from this piece</span></div>
    <label class="chk"><input id="ropeEnabled" type="checkbox"> This piece hangs a rope</label>
    <div id="ropeFields" style="display:none">
      <p class="muted">The piece is the ceiling mount. The rope swings like every rope in the game: a player grabs, pumps, brakes and jumps off it in the ruin, and a burden can hang from it.</p>
      <div class="g2"><div><label>Length</label><input id="ropeLength" type="number" min=".4" step=".05"></div><div><label>Max length (let out)</label><input id="ropeMaxLength" type="number" min=".4" step=".05"></div></div>
      <label style="margin-top:6px">Anchor X / Y / Z (piece-local)</label><div class="g3"><input id="ropeAX" type="number" step=".01"><input id="ropeAY" type="number" step=".01"><input id="ropeAZ" type="number" step=".01"></div>
      <button id="ropeAnchorFromPart" type="button" style="margin-top:6px;width:100%">Set anchor to the bottom centre of the selected part (or piece)</button>
      <div class="g2" style="margin-top:6px"><div><label>Swing direction° (from +X)</label><input id="ropeYaw" type="number" step="5"></div><div><label>Rest angle°</label><input id="ropeRest" type="number" min="-70" max="70" step="5"></div></div>
      <div id="ropeStatus" class="pill" style="margin-top:6px">—</div>
    </div>`;
  host.appendChild(section);

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const setText = (id, text) => { const node = el(id); if (node.textContent !== text) node.textContent = text; };
  const setShown = (id, shown) => { const node = el(id), want = shown ? '' : 'none'; if (node.style.display !== want) node.style.display = want; };

  function syncFields() {
    const rope = state.rope;
    el('ropeEnabled').checked = !!rope?.enabled;
    if (rope?.enabled) {
      el('ropeLength').value = rope.length; el('ropeMaxLength').value = rope.maxLength;
      el('ropeAX').value = rope.anchor.x; el('ropeAY').value = rope.anchor.y; el('ropeAZ').value = rope.anchor.z;
      el('ropeYaw').value = rope.yawDeg; el('ropeRest').value = rope.restAngleDeg;
    }
    refreshReadout();
  }
  // Warnings that matter for feel: the generated ropes' resting grip is ~0.86 above the floor.
  function refreshReadout() {
    const rope = state.rope;
    setShown('ropeFields', !!rope?.enabled);
    if (!rope?.enabled) return;
    const grip = rope.anchor.y - rope.length, problems = [];
    if (grip < 0.3) problems.push(`the resting grip is only ${grip.toFixed(2)} above the floor (the generated ropes use ~0.86): it will sit on the ground`);
    else if (grip > 1.7) problems.push(`the resting grip is ${grip.toFixed(2)} above the floor, out of reach (the generated ropes use ~0.86)`);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (!box.isEmpty() && (rope.anchor.y > box.max.y + 0.06 || rope.anchor.y < box.min.y - 0.06)) problems.push('the anchor is not on the piece: the rope would hang from nothing');
    setText('ropeStatus', problems.length ? `⚠ ${problems.join(' · ')}` : `✓ Resting grip ${grip.toFixed(2)} above the floor; rider can let it out to ${rope.maxLength.toFixed(2)}`);
  }
  function readFields() {
    state.rope = RF.normalize({
      enabled: true, length: num(el('ropeLength').value, 2.1), maxLength: el('ropeMaxLength').value === '' ? undefined : num(el('ropeMaxLength').value, undefined),
      anchor: { x: num(el('ropeAX').value, 0), y: num(el('ropeAY').value, 2.965), z: num(el('ropeAZ').value, 0) },
      yawDeg: num(el('ropeYaw').value, 0), restAngleDeg: num(el('ropeRest').value, 0),
    });
    refreshReadout();
  }

  el('ropeEnabled').onchange = () => {
    if (el('ropeEnabled').checked) { // Default the anchor to the underside of the piece, where a ceiling mount hangs its rope from.
      const box = new THREE.Box3().setFromObject(root), fromPiece = !box.isEmpty();
      state.rope = RF.normalize({ enabled: true, anchor: fromPiece ? { x: (box.min.x + box.max.x) / 2, y: box.min.y, z: (box.min.z + box.max.z) / 2 } : undefined, length: fromPiece ? Math.max(0.4, +(box.min.y - 0.865).toFixed(2)) : undefined });
    } else state.rope = null;
    syncFields();
  };
  for (const id of ['ropeLength', 'ropeMaxLength', 'ropeAX', 'ropeAY', 'ropeAZ', 'ropeYaw', 'ropeRest']) el(id).addEventListener('input', () => { if (state.rope?.enabled) readFields(); });
  el('ropeAnchorFromPart').onclick = () => {
    const selected = state.selectedType === 'part' && typeof meshes !== 'undefined' ? meshes.get(state.selectedId) : null, target = selected || root;
    target.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(target); if (box.isEmpty() || !state.rope?.enabled) return;
    el('ropeAX').value = ((box.min.x + box.max.x) / 2).toFixed(3); el('ropeAY').value = box.min.y.toFixed(3); el('ropeAZ').value = ((box.min.z + box.max.z) / 2).toFixed(3);
    readFields();
    log(`Rope anchor set from the ${selected ? 'selected part' : 'whole piece'}'s bottom centre.`);
  };

  const originalExportData = exportData;
  exportData = function exportFurnitureWithRope() {
    const data = originalExportData();
    if (state.rope?.enabled) data.rope = RF.normalize(state.rope);
    return data;
  };
  const originalLoadData = loadData;
  loadData = function loadFurnitureWithRope(data) {
    originalLoadData(data);
    state.rope = data?.rope ? RF.normalize(data.rope) : null;
    syncFields();
  };
  setInterval(() => { if (!document.hidden && state.rope?.enabled) refreshReadout(); }, 1500);
  syncFields();
})();
