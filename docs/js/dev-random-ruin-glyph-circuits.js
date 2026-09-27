// Makes the Random Test Ruin's projectile glyph puzzles readable.
//
// V50 glyphs are small grey carvings — several sit high on walls and some are
// carved *inside* square pillars, so they were effectively invisible, and
// nothing said which door a glyph drives or how many hits it needs. Each glyph
// circuit (all glyphs linked to one mechanism) now gets:
//   * a colour + name (Azure, Amber, ...),
//   * a glowing rune marker per glyph on the room-facing side of whatever it
//     is carved into (dim + pulsing until struck, bright once struck),
//   * a matching rune and a row of progress pips above its door/platform
//     (one pip per required hit, filled as glyphs are struck).
// The marker is also folded into the glyph's projectile hit box, so shooting
// the rune you can see is what registers.
(() => {
  'use strict';

  const DS = window.DynamicSurfaces;
  const GridTileAccessors = window.GridTileAccessors;
  if (!DS || !GridTileAccessors || !window.THREE) return;

  const MAP_ID = 'map_i_dev_random_ruin';
  const GROUP_NAME = 'dev_ruin_glyph_marker_circuits';
  const PALETTE = Object.freeze([
    { name:'Azure', hex:0x3fc8ff },
    { name:'Amber', hex:0xffb42e },
    { name:'Violet', hex:0xc37bff },
    { name:'Jade', hex:0x46e38a },
    { name:'Crimson', hex:0xff5c5c },
    { name:'Ivory', hex:0xf4eccc },
  ]);
  const MARKER_SIZE = 0.62;
  const MARKER_HIT_RADIUS = 0.3;
  const PIP_SIZE = 0.2;

  let builtRoot = null;
  let group = null;
  let circuits = [];
  let textures = null;

  const tmpBox = new THREE.Box3();

  function inRuin() {
    return GridTileAccessors.getCurrentArea?.() === MAP_ID;
  }

  function runeTexture(filled) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.translate(64, 64);
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.stroke();
    if (filled) { ctx.globalAlpha = .45; ctx.beginPath(); ctx.arc(0, 0, 44, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.lineWidth = 8;
    ctx.beginPath(); // Simple eye-of-the-ruin rune: vertical stroke, chevrons, crossbar.
    ctx.moveTo(0, -30); ctx.lineTo(0, 30);
    ctx.moveTo(-22, -12); ctx.lineTo(0, -30); ctx.lineTo(22, -12);
    ctx.moveTo(-20, 14); ctx.lineTo(20, 14);
    ctx.stroke();
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function pipTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(32, 32, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(32, 32, 14, 0, Math.PI * 2); ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function ensureTextures() {
    if (!textures) textures = { rune:runeTexture(false), runeLit:runeTexture(true), pip:pipTexture() };
    return textures;
  }

  function sprite(texture, color, size) {
    const material = new THREE.SpriteMaterial({ map:texture, color, transparent:true, depthWrite:false, fog:false });
    const object = new THREE.Sprite(material);
    object.scale.set(size, size, 1);
    object.renderOrder = 5;
    object.userData.devRuinFootprintIgnore = true;
    return object;
  }

  function worldBox(object) {
    object.updateWorldMatrix?.(true, true);
    const box = new THREE.Box3().setFromObject(object);
    return box.isEmpty() ? null : box;
  }

  function openAt(x, z, floor, gridBlocked) {
    const key = Math.floor(x) + ',' + Math.floor(z);
    if (!floor.has(key) || gridBlocked.has(key)) return false;
    return !window.DevRandomRuinTileOccupancy?.solidAt?.(x, z, 0);
  }

  // V50 orients every glyph activator so its local -Z faces the opening of
  // its niche / the room side of its wall (yawForLocalNegativeZ). The marker
  // sits just beyond the last solid footprint along that facing, so it is
  // always in front of the carving and inside the room.
  function facingOf(glyphObject) {
    let mount = glyphObject;
    for (let node = glyphObject; node; node = node.parent) {
      if (node.userData?.openingSide || node.userData?.linkedMechanismId) { mount = node; break; }
    }
    mount.updateWorldMatrix(true, false);
    const e = mount.matrixWorld.elements;
    const dx = -e[8], dz = -e[10], length = Math.hypot(dx, dz);
    return length > 1e-4 ? { x:dx / length, z:dz / length } : null;
  }

  function markerPoint(center, glyphObject, floor, gridBlocked) {
    const facing = facingOf(glyphObject);
    if (!facing) return center.clone();
    let exit = 0;
    for (let t = 0; t <= 1.6; t += .03) {
      if (openAt(center.x + facing.x * t, center.z + facing.z * t, floor, gridBlocked)) { exit = t; break; }
    }
    const out = Math.max(exit + .14, .42); // .42 clears the face of V50's pillar-niche housings even where the niche itself reads as open.
    return new THREE.Vector3(center.x + facing.x * out, center.y, center.z + facing.z * out);
  }

  function clear() {
    if (group) {
      group.parent?.remove(group);
      group.traverse(object => object.material?.dispose?.());
    }
    for (const circuit of circuits) for (const target of circuit.targets) {
      delete target.hitBox;
      delete target.circuitName;
    }
    group = null;
    circuits = [];
    builtRoot = null;
  }

  function build(root) {
    clear();
    const snapshot = window.DevRandomRuinTileOccupancy?.getSnapshot?.();
    const source = window.DevRandomRuinHitPuzzles?.getGlyphCircuits?.() || [];
    if (!snapshot || !source.length || !root.parent) return false;
    const floor = new Set(snapshot.floor || []);
    const gridBlocked = new Set(snapshot.gridBlocked || []);
    const tex = ensureTextures();
    group = new THREE.Group();
    group.name = GROUP_NAME;
    root.parent.add(group);

    source.forEach((entry, index) => {
      const colour = PALETTE[index % PALETTE.length];
      const circuit = { ...entry, colour, markers:[], pips:[], badges:[] };
      for (const target of entry.targets) {
        const box = worldBox(target.object);
        if (!box) continue;
        const point = markerPoint(box.getCenter(new THREE.Vector3()), target.object, floor, gridBlocked);
        const marker = sprite(tex.rune, colour.hex, MARKER_SIZE);
        marker.name = 'dev_ruin_glyph_marker_' + target.id;
        marker.position.copy(point);
        group.add(marker);
        circuit.markers.push({ target, marker, glyphCenter:box.getCenter(new THREE.Vector3()) });
        target.circuitName = colour.name;
        target.hitBox = box.clone().union(tmpBox.setFromCenterAndSize(point, new THREE.Vector3(MARKER_HIT_RADIUS * 2, MARKER_HIT_RADIUS * 2, MARKER_HIT_RADIUS * 2)));
      }
      const mechBox = entry.mechanismRoot ? worldBox(entry.mechanismRoot) : null;
      if (mechBox) {
        const center = mechBox.getCenter(new THREE.Vector3());
        const size = mechBox.getSize(new THREE.Vector3());
        const alongX = size.x >= size.z;
        const thin = Math.min(size.x, size.z) < Math.max(size.x, size.z) * .6; // Doors: show the circuit on both faces of the panel; platforms: one set floating above.
        const faces = thin ? [1, -1] : [0];
        for (const side of faces) {
          const out = side * (Math.min(size.x, size.z) * .5 + .3);
          const baseX = center.x + (alongX ? 0 : out), baseZ = center.z + (alongX ? out : 0);
          const badgeY = thin ? mechBox.min.y + Math.min(1.45, size.y * .75) : mechBox.max.y + .9;
          const badge = sprite(tex.runeLit, colour.hex, .46);
          badge.name = 'dev_ruin_glyph_circuit_lamp_' + entry.mechanismId;
          badge.position.set(baseX, badgeY, baseZ);
          group.add(badge);
          circuit.badges.push(badge);
          for (let i = 0; i < entry.required; i++) {
            const offset = (i - (entry.required - 1) / 2) * .28;
            const pip = sprite(tex.pip, colour.hex, PIP_SIZE);
            pip.name = 'dev_ruin_glyph_circuit_lamp_pip_' + entry.mechanismId + '_' + i;
            pip.position.set(baseX + (alongX ? offset : 0), badgeY - .36, baseZ + (alongX ? 0 : offset));
            group.add(pip);
            circuit.pips.push({ pip, index:i });
          }
        }
      }
      circuits.push(circuit);
    });
    builtRoot = root;
    return true;
  }

  function update(now) {
    const pulse = .5 + .5 * Math.sin(now * .004);
    for (const circuit of circuits) {
      let active = 0;
      for (const { target, marker } of circuit.markers) {
        if (target.active) active++;
        marker.material.map = target.active ? textures.runeLit : textures.rune;
        marker.material.opacity = target.active ? 1 : .45 + .35 * pulse;
        const size = target.active ? MARKER_SIZE * 1.12 : MARKER_SIZE * (.94 + .08 * pulse);
        marker.scale.set(size, size, 1);
      }
      const complete = active >= circuit.required;
      for (const { pip, index } of circuit.pips) pip.material.opacity = index < active ? 1 : .22;
      for (const badge of circuit.badges) badge.material.opacity = complete ? 1 : .55 + .25 * pulse;
    }
  }

  function frame() {
    if (!inRuin()) { if (group) clear(); return; }
    const root = window.DevRandomRuinHitPuzzles?.getRoot?.() || null;
    if (!root) { if (group) clear(); return; }
    if (root !== builtRoot && !build(root)) return;
    update(performance.now());
  }

  DS.addBeforeRenderClient(frame);

  window.DevRandomRuinGlyphCircuits = Object.freeze({
    palette:PALETTE,
    rebuild:() => { const root = window.DevRandomRuinHitPuzzles?.getRoot?.(); return root ? build(root) : false; },
    snapshot:() => circuits.map(circuit => ({
      mechanismId:circuit.mechanismId,
      colour:circuit.colour.name,
      required:circuit.required,
      active:circuit.markers.filter(entry => entry.target.active).length,
      markers:circuit.markers.map(({ target, marker, glyphCenter }) => ({ id:target.id, active:!!target.active, x:+marker.position.x.toFixed(3), y:+marker.position.y.toFixed(3), z:+marker.position.z.toFixed(3), gx:+glyphCenter.x.toFixed(3), gz:+glyphCenter.z.toFixed(3) })),
      pips:circuit.pips.length,
      badges:circuit.badges.map(badge => ({ x:+badge.position.x.toFixed(3), y:+badge.position.y.toFixed(3), z:+badge.position.z.toFixed(3) })),
    })),
  });
})();
