'use strict';
const fs = require('node:fs');

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing ${label}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`Failed ${label}`);
  return next;
}

const dualPath = 'docs/js/dual-wield-weapon-visuals.js';
let dual = fs.readFileSync(dualPath, 'utf8');

dual = replaceOnce(dual,
`  function currentPlanePose(current) {`,
`  // Mirrors a proper rotation frame across the child weapon's local X axis.\n  // A reflection itself cannot live in a quaternion, so conjugating the frame\n  // by Mirror-X produces the equivalent proper rotation: X/pitch stays the\n  // same while Y/yaw and Z/roll reverse. This is the orientation counterpart\n  // to offMesh.scale.x = -1 used for the visible opposite-hand weapon.\n  function mirrorQuaternionAcrossLocalX(source, target) {\n    return target.set(source.x, -source.y, -source.z, source.w).normalize();\n  }\n\n  function currentPlanePose(current) {`,
'mirror-quaternion helper');

const oldSocket = `  function transformSocketForHand(record, side, socketFrame) {\n    const current = syncNow();\n    if (!current || current.influence <= ACTIVE_EPSILON || !socketFrame?.position || !socketFrame?.quaternion) return socketFrame;\n    const weapon = side === 'right' ? current.mainMesh : current.offMesh;\n    if (!weapon?.matrixWorld || !current.plane?.matrixWorld) return socketFrame;\n    weapon.updateMatrixWorld?.(true);\n    // Map the hidden original weapon's real grip frame onto the VISIBLE child\n    // weapon. This includes the child-local +/-Z offset and offhand sprite mirror;\n    // using the root here leaves both hands gripping the hidden parent instead.\n    const delta = weapon.matrixWorld.clone().multiply(current.plane.matrixWorld.clone().invert());\n    const position = socketFrame.position.clone().applyMatrix4(delta);\n    const Quaternion = weapon.quaternion.constructor;\n    const planeWorldQ = hierarchyWorldQuaternion(current.plane, new Quaternion());\n    const weaponWorldQ = hierarchyWorldQuaternion(weapon, new Quaternion());\n    const deltaQ = weaponWorldQ.multiply(planeWorldQ.invert()).normalize();\n    const quaternion = deltaQ.multiply(socketFrame.quaternion.clone()).normalize();\n    return {\n      ...socketFrame,\n      position,\n      quaternion,\n      dualWield: {\n        side,\n        influence: current.influence,\n        idleBlend: current.idleBlend,\n        zGap: DUPLICATE_Z_GAP,\n        mainLagMs: MAIN_HAND_LAG_MS,\n      },\n    };\n  }`;

const newSocket = `  function transformSocketForHand(record, side, socketFrame) {\n    const current = syncNow();\n    if (!current || current.influence <= ACTIVE_EPSILON || !socketFrame?.position || !socketFrame?.quaternion) return socketFrame;\n    const weapon = side === 'right' ? current.mainMesh : current.offMesh;\n    if (!weapon?.matrixWorld || !current.plane?.matrixWorld) return socketFrame;\n    weapon.updateMatrixWorld?.(true);\n\n    // Reconstruct the canonical grip IN THE ORIGINAL WEAPON PLANE'S LOCAL SPACE,\n    // then resolve that exact local frame through the visible child weapon. The\n    // previous world-delta shortcut got the point mostly right, but it treated a\n    // reflected child matrix as if its orientation were an ordinary rotation.\n    // That left the hand at the handle with axes that no longer matched it.\n    const inversePlaneWorld = current.plane.matrixWorld.clone().invert();\n    const planeLocalPosition = socketFrame.position.clone().applyMatrix4(inversePlaneWorld);\n    const position = planeLocalPosition.clone().applyMatrix4(weapon.matrixWorld);\n\n    const Quaternion = weapon.quaternion.constructor;\n    const planeWorldQ = hierarchyWorldQuaternion(current.plane, new Quaternion());\n    const weaponWorldQ = hierarchyWorldQuaternion(weapon, new Quaternion());\n    const planeLocalQ = planeWorldQ.clone().invert().multiply(socketFrame.quaternion.clone()).normalize();\n    const mirroredChild = side === 'left' && Number(weapon.scale?.x) < 0;\n    const childLocalQ = mirroredChild\n      ? mirrorQuaternionAcrossLocalX(planeLocalQ, new Quaternion())\n      : planeLocalQ;\n    const quaternion = weaponWorldQ.multiply(childLocalQ).normalize();\n\n    return {\n      ...socketFrame,\n      position,\n      quaternion,\n      dualWield: {\n        side,\n        influence: current.influence,\n        idleBlend: current.idleBlend,\n        zGap: DUPLICATE_Z_GAP,\n        mainLagMs: MAIN_HAND_LAG_MS,\n        mirroredGripFrame: mirroredChild,\n      },\n    };\n  }`;

dual = replaceOnce(dual, oldSocket, newSocket, 'child grip-frame transform');
fs.writeFileSync(dualPath, dual);

const testPath = 'scripts/test-dual-wield-weapon-visuals.js';
let test = fs.readFileSync(testPath, 'utf8');
test = test.replace(
"assert.match(dual, /weapon\\.matrixWorld\\.clone\\(\\)\\.multiply\\(current\\.plane\\.matrixWorld\\.clone\\(\\)\\.invert\\(\\)\\)/, 'child local offset/mirroring is included in the grip socket transform');",
"assert.match(dual, /planeLocalPosition = socketFrame\\.position\\.clone\\(\\)\\.applyMatrix4\\(inversePlaneWorld\\)[\\s\\S]*planeLocalPosition\\.clone\\(\\)\\.applyMatrix4\\(weapon\\.matrixWorld\\)/, 'child grip position is reconstructed in original-plane local space and resolved through the visible child weapon matrix');\nassert.match(dual, /mirrorQuaternionAcrossLocalX[\\s\\S]*source\\.x, -source\\.y, -source\\.z, source\\.w/, 'offhand grip orientation mirrors the proper frame across child-local X instead of losing the reflection in quaternion decomposition');\nassert.match(dual, /mirroredChild = side === 'left' && Number\\(weapon\\.scale\\?\\.x\\) < 0[\\s\\S]*mirrorQuaternionAcrossLocalX\\(planeLocalQ/, 'the reflected offhand child receives the mirrored local grip frame while the main-hand child keeps the original frame');"
);
test = test.replace(
"console.log('dual wield: transform-following roots, child-only sandwich offsets, child-mesh grip sockets, main-hand lag, default 2H, and mutually exclusive editor mode PASS');",
"console.log('dual wield: transform-following roots, child-local grip frames with proper offhand reflection, child-only sandwich offsets, main-hand lag, default 2H, and mutually exclusive editor mode PASS');"
);
fs.writeFileSync(testPath, test);
console.log('Applied explicit child-local dual-wield grip-frame fix.');
