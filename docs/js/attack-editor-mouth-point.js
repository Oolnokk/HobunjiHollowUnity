// Attack Animation Editor: author the species/gender portrait "mouth" point that head-anchored tool poses
// (blowgun, drink) mate their aperture with. Stored through HobunjiPortraitMouthPoints (a draft in this browser;
// "Copy mouth table" produces the JSON to commit in config/portrait-mouth-points.js).
(() => {
  'use strict';

  const POLL_MS = 100;
  const MARKER_MS = 200;
  let panel = null;
  let marker = null;
  let lastAvatar = null; // Detects an avatar rebuild (species/gender/age change) so the inputs follow it.
  let pickActive = false;
  const frameByContext = new WeakMap();

  const $ = id => document.getElementById(id);
  const identity = () => ({ speciesId: $('avatarSpecies')?.value || 'mao-ao', gender: $('avatarGender')?.value || 'male' });
  const store = () => window.HobunjiPortraitMouthPoints;

  function findAvatar(context) {
    let found = null;
    context.bodyRoot.traverse(object => { if (!found && object.userData?.neckRig?.available) found = object; });
    return found;
  }

  function sourceSize(avatar) {
    const canvas = avatar?.userData?.sourceCanvas;
    return { width: Number(canvas?.naturalWidth || canvas?.width) || 0, height: Number(canvas?.naturalHeight || canvas?.height) || 0 };
  }

  // Effective mouth as fractions of the source image: the authored point, else the head centroid.
  function effectivePoint(avatar) {
    const { speciesId, gender } = identity();
    const authored = store()?.get(speciesId, gender);
    if (authored) return { u: authored.u, v: authored.v, authored: true };
    const size = sourceSize(avatar), centroid = avatar?.userData?.neckRig?.headCentroidPx;
    if (!centroid || !size.width || !size.height) return null;
    return { u: centroid.x / size.width, v: centroid.y / size.height, authored: false };
  }

  function refreshInputs(context) {
    if (!panel) return;
    const avatar = findAvatar(context);
    lastAvatar = avatar;
    const point = effectivePoint(avatar);
    const { speciesId, gender } = identity();
    $('mouthPointU').value = point ? point.u.toFixed(4) : '';
    $('mouthPointV').value = point ? point.v.toFixed(4) : '';
    const size = sourceSize(avatar);
    $('mouthPointStatus').textContent = point
      ? `${speciesId}/${gender}: ${point.authored ? 'authored mouth' : 'no mouth authored - using the head centroid'} · u ${point.u.toFixed(3)} v ${point.v.toFixed(3)}${size.width ? ` (${Math.round(point.u * size.width)}, ${Math.round(point.v * size.height)} px of ${size.width}×${size.height})` : ''}`
      : 'Waiting for the preview portrait…';
  }

  function applyAndRefresh(context) {
    window.HobunjiAttackEditorState?.refresh?.(); // Re-poses the tool so the aperture mates with the new mouth.
    refreshInputs(context);
    updateMarker(context);
  }

  function writeFromInputs(context) {
    const u = Number($('mouthPointU').value), v = Number($('mouthPointV').value);
    if (!Number.isFinite(u) || !Number.isFinite(v)) return;
    const { speciesId, gender } = identity();
    if (store()?.set(speciesId, gender, { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) })) applyAndRefresh(context);
  }

  function updateMarker(context) {
    if (!marker) return;
    const show = $('mouthPointMarker')?.checked !== false;
    const avatar = findAvatar(context);
    let frame = frameByContext.get(context);
    if (!frame) frameByContext.set(context, frame = window.SharedAttackPose.createHeadFrame(context.THREE));
    if (!show || !avatar || !window.SharedAttackPose.headFrame(frame, avatar)) { if (marker.visible) marker.visible = false; return; }
    marker.visible = true;
    marker.position.copy(frame.position); // Same point (and same resolver) the head-anchored poses use.
    if (!marker.parent) context.bodyRoot.parent?.add(marker);
  }

  // Finds the source-image fractions whose skinned world position is nearest `world`. The head is scaled/turned by the neck rig, so
  // the pixel->world map is not the flat plane; searching it through the game's own resolver stays exact for any pose or mirroring.
  function sourceFractionsFromWorld(context, avatar, world) {
    const size = sourceSize(avatar), resolver = window.PNGPlaneAvatar?.resolveSkinnedPixelWorldPosition;
    if (!resolver || !size.width) return null;
    const scratch = new context.THREE.Vector3();
    const distanceAt = (x, y) => (resolver(avatar, { x, y }, scratch) ? scratch.distanceTo(world) : Infinity);
    let best = { x: size.width / 2, y: size.height / 2, d: Infinity };
    const GRID = 40;
    for (let i = 0; i <= GRID; i++) for (let j = 0; j <= GRID; j++) {
      const x = (i / GRID) * size.width, y = (j / GRID) * size.height, d = distanceAt(x, y);
      if (d < best.d) best = { x, y, d };
    }
    for (let step = size.width / GRID; step > size.width / 4096; step /= 2) { // Coordinate descent, halving the step: sub-pixel accuracy in ~dozens of queries.
      let moved = true;
      while (moved) {
        moved = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = Math.min(size.width, Math.max(0, best.x + dx * step)), y = Math.min(size.height, Math.max(0, best.y + dy * step)), d = distanceAt(x, y);
          if (d < best.d - 1e-12) { best = { x, y, d }; moved = true; }
        }
      }
    }
    return { u: best.x / size.width, v: best.y / size.height, error: best.d };
  }

  function installPicker(context) {
    const dom = context.renderer.domElement;
    dom.addEventListener('pointerdown', event => {
      if (!pickActive) return;
      event.stopImmediatePropagation(); event.preventDefault();
      pickActive = false; $('mouthPointPick').classList.remove('active');
      const avatar = findAvatar(context), plane = avatar?.userData?.neckRig?.skinnedPlane;
      if (!plane) return;
      const rect = dom.getBoundingClientRect(), THREE = context.THREE;
      const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, context.camera);
      const portraitPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(0, 0, 1).applyQuaternion(plane.getWorldQuaternion(new THREE.Quaternion())), plane.getWorldPosition(new THREE.Vector3()));
      const hitPoint = raycaster.ray.intersectPlane(portraitPlane, new THREE.Vector3()); // The portrait is a flat quad before the neck rig deforms it.
      const fractions = hitPoint && sourceFractionsFromWorld(context, avatar, hitPoint);
      if (!fractions || fractions.error > 0.08) { $('mouthPointStatus').textContent = 'Click missed the portrait - try again on the face.'; return; }
      $('mouthPointU').value = fractions.u.toFixed(4); $('mouthPointV').value = fractions.v.toFixed(4);
      writeFromInputs(context);
    }, true);
  }

  function buildPanel(context) {
    const anchor = $('avatarSpecies')?.closest('.compactGrid');
    if (!anchor) return false;
    panel = document.createElement('details');
    panel.className = 'advancedDetails';
    panel.id = 'mouthPointPanel';
    panel.open = true;
    panel.innerHTML = `
      <summary>Portrait mouth point (this species/gender)</summary>
      <div class="help" id="mouthPointStatus"></div>
      <div class="compactGrid">
        <div class="field"><label>Mouth X (0-1 across the portrait)</label><input id="mouthPointU" type="number" min="0" max="1" step="0.001"></div>
        <div class="field"><label>Mouth Y (0-1 down the portrait)</label><input id="mouthPointV" type="number" min="0" max="1" step="0.001"></div>
      </div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button type="button" class="secondary" id="mouthPointPick">Pick on portrait</button>
        <button type="button" class="secondary" id="mouthPointReset">Use head centroid</button>
        <button type="button" class="secondary" id="mouthPointCopy">Copy mouth table</button>
      </div>
      <label class="fieldRow" style="margin-top:6px"><input id="mouthPointMarker" type="checkbox" checked style="width:auto">Show mouth marker (red sphere)</label>
      <div class="help">Head-anchored actions (blowgun, drink) seat the tool's aperture on this point, so move it to the real mouth. Changes are saved as a draft in this browser and also apply in the game here. To ship them, press Copy mouth table and paste it into <code>POINTS</code> in <code>config/portrait-mouth-points.js</code>.</div>`;
    anchor.insertAdjacentElement('afterend', panel);
    const markerGeometry = new context.THREE.SphereGeometry(0.02, 12, 8);
    marker = new context.THREE.Mesh(markerGeometry, new context.THREE.MeshBasicMaterial({ color: 0xff3355, depthTest: false, transparent: true, opacity: 0.95 }));
    marker.name = 'portrait_mouth_marker';
    marker.renderOrder = 10002;
    marker.frustumCulled = false;
    marker.visible = false;
    context.bodyRoot.parent?.add(marker);

    for (const id of ['mouthPointU', 'mouthPointV']) $(id).addEventListener('change', () => writeFromInputs(context));
    $('mouthPointMarker').addEventListener('change', () => updateMarker(context));
    $('mouthPointPick').addEventListener('click', () => {
      pickActive = !pickActive;
      $('mouthPointPick').classList.toggle('active', pickActive);
      $('mouthPointStatus').textContent = pickActive ? 'Click the mouth on the portrait in the viewport.' : '';
      if (!pickActive) refreshInputs(context);
    });
    $('mouthPointReset').addEventListener('click', () => {
      const { speciesId, gender } = identity();
      store()?.clear(speciesId, gender);
      applyAndRefresh(context);
    });
    $('mouthPointCopy').addEventListener('click', async () => {
      const text = JSON.stringify(store()?.table() || {}, null, 2);
      try { await navigator.clipboard.writeText(text); }
      catch (_) { const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); }
      $('mouthPointStatus').textContent = `Copied ${Object.keys(store()?.table() || {}).length} mouth point(s). Paste into POINTS in config/portrait-mouth-points.js.`;
    });
    for (const id of ['avatarSpecies', 'avatarGender']) $(id).addEventListener('change', () => setTimeout(() => refreshInputs(context), 0));
    installPicker(context);
    return true;
  }

  const bootTimer = setInterval(() => {
    const context = window.HobunjiAttackEditorToolContext;
    if (!context?.bodyRoot?.parent || !window.SharedAttackPose?.headFrame || !store()) return;
    if (!buildPanel(context)) return;
    clearInterval(bootTimer);
    refreshInputs(context);
    setInterval(() => { // Cheap follow-up: re-sync the inputs after an avatar rebuild and keep the marker on the live head.
      if (findAvatar(context) !== lastAvatar) refreshInputs(context);
      updateMarker(context);
    }, MARKER_MS);
  }, POLL_MS);

  window.HobunjiAttackEditorMouthPoint = Object.freeze({ sourceFractionsFromWorld, effectivePoint });
})();
