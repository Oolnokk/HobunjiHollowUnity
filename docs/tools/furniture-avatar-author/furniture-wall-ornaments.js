// Furniture + Avatar Author wall-ornament attachment extension.
// A wall ornament stores a furniture-local attachment frame derived from one
// recognized surface. The preview wall can rotate independently, making it
// possible to inspect the yaw delta the runtime will apply without rotating
// the authored furniture or the rest of the authoring scene.
(() => {
'use strict';

const woq = id => document.getElementById(id); // Used only by this extension's small Surfaces-panel UI.
const WO_VERSION = 1; // Persisted with wallOrnament metadata so future migrations can be explicit.
const DEG = Math.PI / 180; // Used for authoring/runtime yaw conversions.
let previewRoot = null; // Holds the temporary wall/attachment planes in the authoring Three scene.

function finite(value, fallback = 0) {
  const number = Number(value); // Used to reject NaN/Infinity from imported older authoring files.
  return Number.isFinite(number) ? number : fallback;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value)); // Used when exporting attachment metadata without leaking live state references.
}

function selectedSurfaceRecord() {
  const direct = typeof selectedSurface === 'function' ? selectedSurface() : null; // Uses the editor's canonical current surface when available.
  if (direct) return direct;
  const ids = typeof activeSurfaceIds === 'function' ? activeSurfaceIds() : []; // Falls back to the last multi-selected recognized surface.
  return ids?.length ? surfaceGroups.get(ids[ids.length - 1]) : null;
}

function partById(partId) {
  return (state.parts || []).find(part => part.id === partId) || null; // Resolves the owning primitive whose transform defines the furniture-local surface frame.
}

function vector(values, fallback = [0, 0, 0]) {
  const source = Array.isArray(values) ? values : fallback; // Normalizes imported triples before feeding them to THREE.Vector3.
  return new THREE.Vector3(finite(source[0]), finite(source[1]), finite(source[2]));
}

function partEuler(part) {
  const transform = part?.transform || {}; // Supplies authored primitive rotation while scale remains baked into generated geometry.
  return new THREE.Euler(finite(transform.rx) * DEG, finite(transform.ry) * DEG, finite(transform.rz) * DEG, 'XYZ');
}

function objectLocalFrame(surface) {
  const part = surface && partById(surface.partId); // Owning primitive is required to convert recognized-surface coordinates into furniture coordinates.
  if (!surface || !part) return null;
  const transform = part.transform || {}; // Provides the primitive translation after its local surface vectors are rotated.
  const rotation = partEuler(part); // Reused across anchor, normal, and tangent conversion.
  const anchor = vector(surface.localCentroid).applyEuler(rotation).add(new THREE.Vector3(finite(transform.x), finite(transform.y), finite(transform.z))); // Furniture-local point where the target wall must meet the ornament.
  const normal = vector(surface.localNormal, [0, 0, 1]).applyEuler(rotation).normalize(); // Furniture-local outward normal of the selected attachment face.
  const basisU = vector(surface.basisU, [1, 0, 0]).applyEuler(rotation).normalize(); // First tangent retained for diagnostics/future non-yaw wall alignment.
  const basisV = vector(surface.basisV, [0, 1, 0]).applyEuler(rotation).normalize(); // Second tangent retained for diagnostics/future non-yaw wall alignment.
  return { anchor, normal, basisU, basisV, part };
}

function yawOf(vector3) {
  return Math.atan2(vector3.x, vector3.z) / DEG; // Converts a horizontal normal into the game's +Z-based yaw convention.
}

function normalizedDegrees(value) {
  let degrees = finite(value); // Keeps the readout and serialized preview angle compact and deterministic.
  while (degrees <= -180) degrees += 360;
  while (degrees > 180) degrees -= 360;
  return degrees;
}

function yawDeltaFor(record) {
  const normal = vector(record?.normal, [0, 0, 1]); // Authored attachment normal is aligned opposite the target wall's outward normal.
  const targetWallYaw = finite(record?.previewWallAngleDeg); // Editor-only target wall angle used to demonstrate runtime alignment.
  return normalizedDegrees(targetWallYaw + 180 - yawOf(normal));
}

function makeRecord(surface, previous = null) {
  const frame = objectLocalFrame(surface); // Captured once so runtime placement never needs to reconstruct author-tool geometry.
  if (!frame) return null;
  return {
    version: WO_VERSION,
    attachmentSurfaceId: surface.id,
    surfacePartId: surface.partId,
    surfaceType: surface.recognizedType || '',
    surfaceFaces: [...(surface.faceIndices || [])],
    anchor: frame.anchor.toArray(),
    normal: frame.normal.toArray(),
    basisU: frame.basisU.toArray(),
    basisV: frame.basisV.toArray(),
    previewWallAngleDeg: finite(previous?.previewWallAngleDeg, 0),
    defaultNormalOffset: Math.max(0, finite(previous?.defaultNormalOffset, 0.01)),
    placementSpace: 'wall-surface-uvn',
    alignment: 'attachment-normal-opposes-wall-normal',
  };
}

function ensurePreviewRoot() {
  if (previewRoot || typeof scene === 'undefined' || !scene?.add) return previewRoot;
  previewRoot = new THREE.Group(); // Keeps every temporary preview primitive removable as one unit.
  previewRoot.name = 'WallOrnamentAttachmentPreview';
  scene.add(previewRoot);
  return previewRoot;
}

function clearPreview() {
  if (!previewRoot) return;
  previewRoot.parent?.remove(previewRoot);
  previewRoot.traverse?.(node => {
    node.geometry?.dispose?.();
    if (Array.isArray(node.material)) node.material.forEach(material => material?.dispose?.());
    else node.material?.dispose?.();
  });
  previewRoot = null;
}

function makePlane(width, height, color, opacity) {
  const geometry = new THREE.PlaneGeometry(width, height); // Preview-only geometry; never exported with furniture.
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }); // Transparent material keeps authored furniture visible behind the wall guide.
  return new THREE.Mesh(geometry, material);
}

function orientPlaneToNormal(mesh, normal) {
  const forward = new THREE.Vector3(0, 0, 1); // PlaneGeometry faces +Z before alignment.
  mesh.quaternion.setFromUnitVectors(forward, normal.clone().normalize());
}

function refreshPreview() {
  clearPreview();
  const record = state.wallOrnament; // Current persisted attachment record drives both preview guides and the readout.
  const readout = woq('wallOrnamentReadout'); // Human-readable diagnostics are intentionally visible on mobile without console access.
  if (!record) {
    if (readout) readout.textContent = 'Ordinary floor furniture — no wall attachment surface selected.';
    return;
  }
  const root = ensurePreviewRoot(); // Authoring Three scene may not exist during the first extension tick.
  if (!root) return;

  const anchor = vector(record.anchor); // Furniture-local anchor remains fixed while the target wall guide rotates.
  const wallYaw = finite(record.previewWallAngleDeg) * DEG; // Slider angle becomes the target wall's outward horizontal normal.
  const wallNormal = new THREE.Vector3(Math.sin(wallYaw), 0, Math.cos(wallYaw)).normalize(); // Target wall outward normal used by runtime placement.
  const wallPlane = makePlane(2.4, 2.4, 0x65b8ff, 0.18); // Large blue guide represents the wall itself.
  wallPlane.name = 'WallOrnamentPreviewWall';
  wallPlane.position.copy(anchor).addScaledVector(wallNormal, -0.002);
  orientPlaneToNormal(wallPlane, wallNormal);
  root.add(wallPlane);

  const surface = surfaceGroups.get(record.attachmentSurfaceId); // Current recognized surface supplies a useful marker size when geometry still matches.
  const spanU = Math.max(0.08, finite(surface?.bounds?.maxU) - finite(surface?.bounds?.minU)); // Marker width mirrors the selected face rather than using an arbitrary square.
  const spanV = Math.max(0.08, finite(surface?.bounds?.maxV) - finite(surface?.bounds?.minV)); // Marker height mirrors the selected face.
  const attachmentPlane = makePlane(spanU, spanV, 0xffb347, 0.72); // Orange marker shows where the selected face lands on the rotated wall.
  attachmentPlane.name = 'WallOrnamentPreviewAttachmentSurface';
  attachmentPlane.position.copy(anchor).addScaledVector(wallNormal, 0.003);
  orientPlaneToNormal(attachmentPlane, wallNormal.clone().negate());
  root.add(attachmentPlane);

  if (readout) {
    const sourceYaw = yawOf(vector(record.normal, [0, 0, 1])); // Exposes the exact authored face direction used in runtime math.
    const delta = yawDeltaFor(record); // Shows how much the furniture root would rotate for this preview wall.
    readout.textContent = `Attachment ${record.attachmentSurfaceId} · authored normal ${sourceYaw.toFixed(1)}° · wall ${finite(record.previewWallAngleDeg).toFixed(1)}° · furniture yaw delta ${delta.toFixed(1)}° · default normal offset ${finite(record.defaultNormalOffset).toFixed(3)}`;
  }
}

function markSelectedSurface() {
  const surface = selectedSurfaceRecord(); // User selection under Surfaces is the single source of truth for attachment choice.
  if (!surface) { log?.('Select a recognized furniture surface first.', 'warn'); return; }
  const record = makeRecord(surface, state.wallOrnament); // Replaces stale geometry data while retaining preview/user defaults.
  if (!record) { log?.('Could not resolve the selected surface transform.', 'warn'); return; }
  for (const group of surfaceGroups.values()) if (group.role === 'wallAttachment') group.role = 'none'; // Exactly one recognized surface may own the attachment role.
  surface.role = 'wallAttachment';
  state.wallOrnament = record;
  refreshUi();
  queueUndoHistory?.('mark wall ornament attachment surface');
  log?.(`Wall ornament attachment set to ${surface.id}.`);
}

function clearAttachment() {
  const priorId = state.wallOrnament?.attachmentSurfaceId; // Used to clear the visible role on the former recognized surface.
  const prior = priorId ? surfaceGroups.get(priorId) : null; // Current surface record may have been regenerated after geometry edits.
  if (prior?.role === 'wallAttachment') prior.role = 'none';
  state.wallOrnament = null;
  refreshUi();
  queueUndoHistory?.('clear wall ornament attachment surface');
}

function updatePreviewSettings() {
  if (!state.wallOrnament) return;
  state.wallOrnament.previewWallAngleDeg = normalizedDegrees(woq('wallOrnamentPreviewAngle')?.value); // Editor-only wall yaw retained so reopening the file reproduces the preview.
  state.wallOrnament.defaultNormalOffset = Math.max(0, finite(woq('wallOrnamentNormalOffset')?.value, 0.01)); // Runtime starting gap prevents z-fighting against target walls.
  refreshPreview();
  queueUndoHistory?.('edit wall ornament preview');
}

function refreshUi() {
  const record = state.wallOrnament; // Drives enabled/disabled controls and visible values.
  const angle = woq('wallOrnamentPreviewAngle'); // Slider demonstrates arbitrary wall yaw without rotating authored geometry.
  const angleNumber = woq('wallOrnamentPreviewAngleNumber'); // Numeric twin is easier for exact authoring.
  const offset = woq('wallOrnamentNormalOffset'); // Surface-normal gap used as placement default.
  if (angle) { angle.disabled = !record; angle.value = finite(record?.previewWallAngleDeg); }
  if (angleNumber) { angleNumber.disabled = !record; angleNumber.value = finite(record?.previewWallAngleDeg); }
  if (offset) { offset.disabled = !record; offset.value = finite(record?.defaultNormalOffset, 0.01); }
  woq('clearWallOrnamentAttachment')?.toggleAttribute('disabled', !record);
  refreshPreview();
}

function installUi() {
  if (woq('wallOrnamentPanel')) return;
  const host = woq('tab-surfaces'); // Wall attachment belongs beside recognized surface authoring, not in general furniture settings.
  if (!host) return;
  const panel = document.createElement('div'); // Self-contained section avoids touching the giant V58 editor HTML.
  panel.id = 'wallOrnamentPanel';
  panel.className = 'section';
  panel.innerHTML = `<h2>Wall Ornament Attachment</h2>
    <div class="muted">Mark one recognized surface as the wall-contact face. Placement aligns that face against a target wall; the furniture's authored axes do not have to match the wall normal.</div>
    <div class="g2" style="margin-top:6px"><button id="markWallOrnamentAttachment" class="ok">Use Selected Surface as Attachment</button><button id="clearWallOrnamentAttachment" class="bad">Return to Floor Furniture</button></div>
    <label>Preview wall angle <span class="muted">(yaw°)</span></label>
    <div class="g2"><input id="wallOrnamentPreviewAngle" type="range" min="-180" max="180" step="1"><input id="wallOrnamentPreviewAngleNumber" type="number" min="-180" max="180" step="1"></div>
    <label>Default wall distance <span class="muted">(normal offset)</span></label><input id="wallOrnamentNormalOffset" type="number" min="0" step="0.001">
    <div id="wallOrnamentReadout" class="readout muted" style="margin-top:6px"></div>`;
  host.prepend(panel);
  woq('markWallOrnamentAttachment').onclick = markSelectedSurface;
  woq('clearWallOrnamentAttachment').onclick = clearAttachment;
  woq('wallOrnamentPreviewAngle').addEventListener('input', event => {
    const number = woq('wallOrnamentPreviewAngleNumber'); // Keeps slider and exact numeric field synchronized while dragging.
    if (number) number.value = event.target.value;
    if (state.wallOrnament) { state.wallOrnament.previewWallAngleDeg = normalizedDegrees(event.target.value); refreshPreview(); }
  });
  woq('wallOrnamentPreviewAngle').addEventListener('change', updatePreviewSettings);
  woq('wallOrnamentPreviewAngleNumber').addEventListener('change', event => {
    const slider = woq('wallOrnamentPreviewAngle'); // Mirrors an exact typed angle back into the preview slider.
    if (slider) slider.value = event.target.value;
    updatePreviewSettings();
  });
  woq('wallOrnamentNormalOffset').addEventListener('change', updatePreviewSettings);
  refreshUi();
}

const originalExport = exportData; // Wrapped so wall attachment metadata is part of the same authored JSON as geometry/decals.
exportData = function exportFurnitureWithWallOrnament(...args) {
  const data = originalExport(...args); // Existing exporters remain authoritative for every unrelated furniture field.
  if (state.wallOrnament) data.wallOrnament = clone(state.wallOrnament);
  else delete data.wallOrnament;
  return data;
};

const originalLoad = loadData; // Wrapped so imported/repository furniture restores its attachment frame and preview settings.
loadData = function loadFurnitureWithWallOrnament(data, ...args) {
  state.wallOrnament = data?.wallOrnament ? clone(data.wallOrnament) : null;
  const result = originalLoad(data, ...args); // Surface regeneration happens in the base loader before the preview is refreshed.
  const surface = state.wallOrnament?.attachmentSurfaceId ? surfaceGroups.get(state.wallOrnament.attachmentSurfaceId) : null; // Reconnects the semantic role to the regenerated recognized surface.
  if (surface) surface.role = 'wallAttachment';
  refreshUi();
  return result;
};

const originalClear = clearFurniture; // Wrapped so a new furniture document never inherits a stale wall attachment.
clearFurniture = function clearFurnitureWithWallOrnament(...args) {
  const result = originalClear(...args); // Existing reset remains responsible for parts, surfaces, and decals.
  state.wallOrnament = null;
  refreshUi();
  return result;
};

const originalRebuild = rebuildFurnitureMeshes; // Wrapped so geometry edits keep the preview guide in sync without a render-loop poll.
rebuildFurnitureMeshes = function rebuildFurnitureWithWallOrnament(...args) {
  const result = originalRebuild(...args); // Base rebuild recreates surface groups first.
  if (state.wallOrnament?.attachmentSurfaceId) {
    const surface = surfaceGroups.get(state.wallOrnament.attachmentSurfaceId); // Same-id surfaces are recaptured to keep anchor/frame data current.
    const updated = surface && makeRecord(surface, state.wallOrnament); // Geometry edits can move/rotate the chosen attachment face.
    if (surface && updated) { surface.role = 'wallAttachment'; state.wallOrnament = updated; }
  }
  refreshUi();
  return result;
};

installUi();
window.FurnitureWallOrnamentAuthor = {
  version: WO_VERSION,
  refresh: refreshUi,
  debugSnapshot: () => ({ wallOrnament: clone(state.wallOrnament), selectedSurfaceId: selectedSurfaceRecord()?.id || null, previewVisible: !!previewRoot }),
};
})();
