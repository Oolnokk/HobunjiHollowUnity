'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const read=path=>fs.readFileSync(path,'utf8');
const json=path=>JSON.parse(read(path));
const statue=json('docs/config/furniture-authored/keyStatue.json');
const dispenser=json('docs/config/furniture-authored/keyStatueDispenser.json');
const index=json('docs/config/furniture-authored/index.json');

assert.equal(statue.key,'keyStatue');
assert(statue.carryable.enabled);
assert(statue.carryable.handTargets.left&&statue.carryable.handTargets.right);
assert(statue.parts.some(part=>part.id==='key_statue_key_bow'),'the statue visibly carries a key crest');
assert.equal(dispenser.puzzle.role,'activator');
assert.equal(dispenser.puzzle.behavior,'keyStatue');
assert.equal(dispenser.puzzle.payloadPartId,'key_statue_button');
const button=dispenser.parts.find(part=>part.id==='key_statue_button');
const cavity=dispenser.parts.find(part=>part.id==='key_statue_cavity');
assert(button&&cavity,'the dispenser has a moving button and a separate cavity surface');
assert.equal(cavity.color,'#050505');
const states=dispenser.puzzle.motion.parts.key_statue_button;
assert(states.off.y>states.on.y,'the statue button starts halfway raised and sinks when the payload is taken');
assert.equal(states.off.sy,states.on.sy,'the button moves without changing its size');
assert.equal(dispenser.puzzle.motion.durationSeconds,.72);
assert(index.furniture.some(item=>item.key==='keyStatue'));
assert(index.furniture.some(item=>item.key==='keyStatueDispenser'));

const window={};
vm.runInNewContext(read('docs/js/furniture-puzzle-properties.js'),{window});
const puzzle=window.FurniturePuzzleProperties;
assert(puzzle.ACTIVATORS.includes('keyStatue'));
const normalized=puzzle.normalizePuzzle(dispenser.puzzle);
assert.equal(normalized.behavior,'keyStatue');
assert.equal(normalized.payloadPartId,'key_statue_button');
assert.deepEqual(
 JSON.parse(JSON.stringify(normalized.motion.parts.key_statue_button.off)),
 JSON.parse(JSON.stringify(states.off)),
 'the authored OFF button transform survives puzzle normalization'
);
assert.deepEqual(
 JSON.parse(JSON.stringify(normalized.motion.parts.key_statue_button.on)),
 JSON.parse(JSON.stringify(states.on)),
 'the authored ON button transform survives puzzle normalization'
);

const runtime=read('docs/js/furniture-puzzle-runtime.js');
assert(runtime.includes("['burdenPlate','keyStatue'].includes(puzzle.behavior)"));
assert(runtime.includes('function keyStatueButtons('));
assert(runtime.includes('function interactKeyStatue('));
assert(runtime.includes('function setKeyStatueTaken('));
assert(runtime.includes('window.Shattercasks?.pickUp?.(payload)'));
assert(runtime.includes('activate(mapId, id, !!taken)'),'taking/returning the statue emits its activator channel');

const keyRuntime=read('docs/js/key-statues.js');
assert(keyRuntime.includes('payloadAttachmentAnchors'));
assert(keyRuntime.includes('payloadPartId'));
assert(keyRuntime.includes("kind:'keyStatue'"));
assert(keyRuntime.includes("onPickup:record=>"));
assert(keyRuntime.includes("onLost:(record,cause)=>lostStatue"));
assert(keyRuntime.includes("setKeyStatueTaken?.(state.mapId,state.id,false)"),'a replacement begins its ON→OFF reset animation');
assert(keyRuntime.includes('queueRespawn(state,reason)'));
assert(keyRuntime.includes("discardBurden?.(lost)"),'orphaned Burdens are removed from the shared registry');
assert(keyRuntime.includes('keyStatueMounted'),'the floor hazard check excludes the mounted initial payload');

const table=read('docs/js/furniture-table-system.js');
assert(table.includes("['burdenPlate','keyStatue'].includes(puzzle.behavior)"));
assert(table.includes('keyStatueButtons?.(area, id)'));
assert(table.includes('interactKeyStatue?.(area, id, action)'));
assert(table.includes('KeyStatues?.registerDispenser?.(area, id, root, puzzle)'));
const puzzleRuntime=read('docs/js/furniture-puzzle-runtime.js');
assert(puzzleRuntime.includes('KeyStatues?.unregisterDispenser?.(mapId,id)'));

const carry=read('docs/js/shattercasks.js');
assert(carry.includes('onPickup:typeof options.onPickup'));
assert(carry.includes('onLost:typeof options.onLost'));
assert(carry.includes('function pickUp(cask)'));
assert(carry.includes('cask.onPickup?.(cask)'));

console.log('Key Statue: authored statue/dispenser, inverted button transforms, mounted Burden, pickup channel, automatic loss cleanup and ON→OFF restoration checks passed.');
