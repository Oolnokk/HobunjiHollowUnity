'use strict';
const fs = require('node:fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function write(path, source) { fs.writeFileSync(path, source); }
function replaceExact(path, oldText, newText, label) {
  const source = read(path);
  if (!source.includes(oldText)) throw new Error(`Expected target not found in ${path}: ${label}`);
  write(path, source.replace(oldText, newText));
}

const driverPath = 'docs/js/procedural-hand-frame-driver.js';
const dualPath = 'docs/js/dual-wield-weapon-visuals.js';
const gripPath = 'docs/js/hand-tool-grips.js';
const ownershipPath = 'scripts/runtime-frame-ownership-exceptions.json';

replaceExact(
  driverPath,
`      const dualWield = toolGrips.dualWieldStateForTool?.(toolKey, gripContext, scaleIdentity) || null;
      const primaryGrip = toolGrips.primaryGripForTool(toolKey, gripContext, scaleIdentity);
      const basePrimarySocket = toolSocketWorld(record, toolHolder, primaryGrip); // Raw fixed 1H target on the hidden/original weapon.
      const primarySocket = dualWield
        ? (global.HobunjiDualWieldWeaponVisuals?.transformSocketForHand?.(record, 'right', basePrimarySocket) || basePrimarySocket)
        : basePrimarySocket;
      record.rig.placePaperHandGuideWorld?.(primarySocket.position, primarySocket.quaternion);
      const primary = handSocketAfterGripMode(record, primarySocket);
      const modelCalibration = modelCalibrationForRecord(record);
      record.rig.placeHandWorld?.('right', primary.position, primary.quaternion, modelCalibration);
      ensureFallbackState(record).owners.right = dualWield ? 'dual-wield-main-grip' : 'primary-grip';`,
`      const dualWield = toolGrips.dualWieldStateForTool?.(toolKey, gripContext, scaleIdentity) || null;
      const primaryGrip = toolGrips.primaryGripForTool(toolKey, gripContext, scaleIdentity);
      const primarySocket = toolSocketWorld(record, toolHolder, primaryGrip); // Raw fixed 1H target remains the canonical weapon-grip reference before optional Dual Wield remapping.
      record.rig.placePaperHandGuideWorld?.(primarySocket.position, primarySocket.quaternion);
      let primary = handSocketAfterGripMode(record, primarySocket); // Preserve the ordinary raw-socket contract for 1H/2H and diagnostics.
      if (dualWield) {
        const dualPrimarySocket = global.HobunjiDualWieldWeaponVisuals?.transformSocketForHand?.(record, 'right', primarySocket) || primarySocket;
        primary = handSocketAfterGripMode(record, dualPrimarySocket); // Dual Wield alone remaps the same canonical grip onto the lagged main-hand weapon copy.
      }
      const modelCalibration = modelCalibrationForRecord(record);
      record.rig.placeHandWorld?.('right', primary.position, primary.quaternion, modelCalibration);
      const owners = ensureFallbackState(record).owners;
      owners.right = 'primary-grip'; // Ordinary attachment ownership always wins over locomotion fallback.
      if (dualWield) owners.right = 'dual-wield-main-grip'; // Dual Wield refines that ownership to the lagged duplicate weapon.`,
  'preserve raw primary socket and ordinary ownership contract',
);

replaceExact(
  dualPath,
`  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('dual-wield-weapon-visuals', syncNow, {
      phase: 'pre-render',
      owner: 'HobunjiDualWieldWeaponVisuals',
      description: 'Maintains hidden-original dual weapon duplicates and their small main-hand transform lag before hand/socket render sync.',
    });
  } else {
    const frame = () => { syncNow(); global.requestAnimationFrame?.(frame); };
    global.requestAnimationFrame?.(frame);
  }`,
`  if (global.RuntimeFrameScheduler?.register) {
    global.RuntimeFrameScheduler.register('dual-wield-weapon-visuals', syncNow, {
      phase: 'pre-render',
      owner: 'HobunjiDualWieldWeaponVisuals',
      description: 'Maintains hidden-original dual weapon duplicates and their small main-hand transform lag before hand/socket render sync.',
    });
  }
  // Standalone editor contexts do not need a second RAF loop: the hand frame driver,
  // grip-mode toggles, and transformSocketForHand() all call syncNow() synchronously.
  // Keeping a single owner avoids duplicate transform-history samples and frame-order ambiguity.`,
  'remove redundant dual-wield standalone RAF loop',
);

const ownership = JSON.parse(read(ownershipPath));
const gripEntry = ownership.find(entry => entry.file === gripPath && entry.owner === 'HobunjiHandToolGrips');
if (!gripEntry) throw new Error('Missing HobunjiHandToolGrips frame-ownership exception');
const gripLines = read(gripPath).split(/\r?\n/);
const gripRafLine = gripLines.findIndex(line => line.includes('global.requestAnimationFrame(frame);')) + 1;
if (!gripRafLine) throw new Error('Could not locate hand-tool-grips fallback RAF');
gripEntry.line = gripRafLine;
write(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);

if (read(dualPath).includes('requestAnimationFrame')) throw new Error('Dual-wield module must not own a direct RAF after cleanup');
if (!read(driverPath).includes("owners.right = 'primary-grip'")) throw new Error('Driver must retain explicit primary-grip fallback ownership');
if (!read(driverPath).includes('const primarySocket = toolSocketWorld(record, toolHolder, primaryGrip)')) throw new Error('Driver must retain canonical raw primary socket');

console.log(`Dual-wield CI cleanup applied; hand-tool-grips RAF audit line is now ${gripRafLine}.`);
