// Furniture Avatar Author: editable seat-target normal offsets.
// Loaded only by docs/tools/furniture-avatar-author/ after the V58 editor boots.
(() => {
'use strict';
const DEFAULT_SEAT_NORMAL_OFFSET = 0.01; // Used for new/reset seat targets; matches the current repo standard chair/bench authored offset above the editor's 0.012 surface clearance.
window.HOBUNJI_DEFAULT_SEAT_NORMAL_OFFSET = DEFAULT_SEAT_NORMAL_OFFSET;
const $seat = id => document.getElementById(id);
const anchorY = anchor => Number.isFinite(Number(anchor?.position?.y)) ? Number(anchor.position.y) : DEFAULT_SEAT_NORMAL_OFFSET;

normalizeSeatAnchorRecords = function normalizeEditableSeatAnchors() {
  state.seatAnchors = Array.isArray(state.seatAnchors) ? state.seatAnchors : [];
  const seen = new Set(), clean = [];
  for (const source of state.seatAnchors) {
    if (!source?.surfaceId || !surfaceGroups.has(source.surfaceId) || ensureSurfaceSetting(surfaceGroups.get(source.surfaceId)).role !== 'seat') continue;
    const cell = seatGridCellPosition(source.surfaceId, source.gridCell?.column || 0, source.gridCell?.row || 0);
    if (!cell) continue;
    const key = seatAnchorCellKey(source.surfaceId, cell.column, cell.row);
    if (seen.has(key)) continue;
    seen.add(key);
    const position = normalizeAnchorVector(source.position, {x:0,y:DEFAULT_SEAT_NORMAL_OFFSET,z:0});
    position.y = anchorY(source);
    const rotation = normalizeAnchorVector(source.rotation, {x:-5,y:0,z:0});
    if (!source.rotation || !Number.isFinite(Number(source.rotation.x)) || Math.abs(Number(source.rotation.x) + 10) < 1e-9) rotation.x = -5;
    clean.push({id:source.id || uid('seatAnchor'),surfaceId:source.surfaceId,gridCell:{column:cell.column,row:cell.row},position,rotation});
  }
  state.seatAnchors = clean;
};

seatAnchorForCell = function seatAnchorForCellEditable(surfaceId,column,row,create=true,legacyTilt=-5) {
  if (!surfaceId) return null;
  const cell = seatGridCellPosition(surfaceId,column,row);
  if (!cell) return null;
  let anchor = (state.seatAnchors || []).find(candidate => candidate.surfaceId === surfaceId && Number(candidate.gridCell?.column) === cell.column && Number(candidate.gridCell?.row) === cell.row);
  if (!anchor && create) {
    const rawTilt = Number.isFinite(Number(legacyTilt)) ? Number(legacyTilt) : -5;
    const tilt = Math.abs(rawTilt + 10) < 1e-9 ? -5 : rawTilt;
    anchor = {id:uid('seatAnchor'),surfaceId,gridCell:{column:cell.column,row:cell.row},position:{x:0,y:DEFAULT_SEAT_NORMAL_OFFSET,z:0},rotation:{x:tilt,y:0,z:0}};
    state.seatAnchors.push(anchor);
  }
  if (anchor) anchor.position = {x:Number(anchor.position?.x)||0,y:anchorY(anchor),z:Number(anchor.position?.z)||0};
  return anchor;
};

seatAnchorWorldTransform = function seatAnchorWorldTransformEditable(anchor) {
  const base = seatAnchorBaseFrame(anchor);
  if (!base) return null;
  const localPosition = new THREE.Vector3(Number(anchor.position?.x)||0, anchorY(anchor), Number(anchor.position?.z)||0);
  const localQuaternion = quaternionFromDegrees(anchor.rotation);
  return {...base,position:base.position.clone().add(localPosition.clone().applyQuaternion(base.quaternion)),quaternion:base.quaternion.clone().multiply(localQuaternion),localPosition,localQuaternion};
};

applySeatAnchorObjectTransform = function applySeatAnchorObjectTransformEditable(anchor,object=seatAnchorTransformProxy) {
  const base = seatAnchorBaseFrame(anchor);
  if (!anchor || !object || !base) return;
  const inverseBase = base.quaternion.clone().invert();
  const localPosition = object.position.clone().sub(base.position).applyQuaternion(inverseBase);
  const localQuaternion = inverseBase.multiply(object.quaternion.clone());
  anchor.position = {x:+localPosition.x.toFixed(4),y:+localPosition.y.toFixed(4),z:+localPosition.z.toFixed(4)};
  anchor.rotation = degreesFromQuaternion(localQuaternion);
  object.scale.set(1,1,1);
  syncSeatAnchorTransformProxy(anchor); syncSeatAnchorMarker(anchor); updateSeatedAvatarsForAnchor(anchor);
};

applySeatAnchorFields = function applySeatAnchorFieldsEditable() {
  const anchor = selectedSeatAnchor(); if (!anchor) return;
  anchor.position = {x:num('seatAnchorX',0),y:num('seatAnchorY',DEFAULT_SEAT_NORMAL_OFFSET),z:num('seatAnchorZ',0)};
  anchor.rotation = {x:num('seatAnchorRX',-5),y:num('seatAnchorRY',0),z:num('seatAnchorRZ',0)};
  syncSeatAnchorTransformProxy(anchor); syncSeatAnchorMarker(anchor); transform.attach(seatAnchorTransformProxy);
  updateSeatedAvatarsForAnchor(anchor); refreshSelectionUI(); renderSeatingUI();
};

resetSelectedSeatAnchor = function resetSelectedSeatAnchorEditable() {
  const anchor = selectedSeatAnchor(); if (!anchor) return;
  anchor.position={x:0,y:DEFAULT_SEAT_NORMAL_OFFSET,z:0}; anchor.rotation={x:-5,y:0,z:0};
  syncSeatAnchorTransformProxy(anchor); syncSeatAnchorMarker(anchor); updateSeatedAvatarsForAnchor(anchor);
  transform.attach(seatAnchorTransformProxy); refreshSelectionUI(); renderSeatingUI(); queueUndoHistory('reset seat anchor');
};

const originalConfigureSeatAxes = configureTransformAxesForSelection;
configureTransformAxesForSelection = function configureEditableSeatAxes() {
  originalConfigureSeatAxes();
  if (state.selectedType === 'seatAnchor') { transform.showX=true; transform.showY=true; transform.showZ=true; transform.setSpace?.('local'); }
};

// setupEvents() captured V58's fixed-Y listeners. Replace the six inputs once,
// then bind them to the editable handler instead.
for (const id of ['seatAnchorX','seatAnchorY','seatAnchorZ','seatAnchorRX','seatAnchorRY','seatAnchorRZ']) {
  const oldInput=$seat(id); if (!oldInput || oldInput.dataset.editableSeatOffset==='1') continue;
  const input=oldInput.cloneNode(true); input.dataset.editableSeatOffset='1'; oldInput.replaceWith(input); input.addEventListener('change',applySeatAnchorFields);
}
const yInput=$seat('seatAnchorY');
if (yInput) { yInput.readOnly=false; yInput.removeAttribute('readonly'); yInput.title='Editable offset along the seat surface normal'; yInput.value=String(DEFAULT_SEAT_NORMAL_OFFSET); }
const yLabel=yInput?.closest('div')?.querySelector('label'); if (yLabel) yLabel.textContent='Normal offset';
const resetBtn=$seat('resetSeatAnchorBtn'); if (resetBtn) resetBtn.onclick=resetSelectedSeatAnchor;

const originalSeatExportData = exportData;
exportData = function exportEditableSeatData() {
  const data=originalSeatExportData();
  data.seatAnchors=JSON.parse(JSON.stringify(state.seatAnchors||[]));
  if (data.seatLegModel) {
    data.seatLegModel.defaultSeatNormalOffset=DEFAULT_SEAT_NORMAL_OFFSET;
    data.seatLegModel.anchorLocalYRule=`seat-anchor normal offset is authored per anchor; new anchors default to ${DEFAULT_SEAT_NORMAL_OFFSET.toFixed(2)}`;
    if (data.seatLegModel.seatGeometryCalibration) data.seatLegModel.seatGeometryCalibration.seatAnchorLocalY=DEFAULT_SEAT_NORMAL_OFFSET;
  }
  return data;
};

const originalSeatLoadData = loadData;
loadData = function loadEditableSeatData(data) {
  const imported=JSON.parse(JSON.stringify(data?.seatAnchors||[]));
  const result=originalSeatLoadData(data);
  for (const anchor of state.seatAnchors||[]) {
    const source=imported.find(candidate=>candidate.id===anchor.id) || imported.find(candidate=>candidate.surfaceId===anchor.surfaceId && Number(candidate.gridCell?.column)===Number(anchor.gridCell?.column) && Number(candidate.gridCell?.row)===Number(anchor.gridCell?.row));
    anchor.position={...(anchor.position||{}),y:Number.isFinite(Number(source?.position?.y))?Number(source.position.y):DEFAULT_SEAT_NORMAL_OFFSET};
  }
  normalizeSeatAnchorRecords(); rebuildSeatGrid(); rebuildSeatedAvatars(); renderSeatingUI();
  return result;
};

log(`Seat target normal offset unlocked; new anchors default to ${DEFAULT_SEAT_NORMAL_OFFSET.toFixed(2)}.`);
})();
