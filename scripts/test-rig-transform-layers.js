// Executable ownership tests: multiple simultaneous layers, handoffs,
// interruption/cleanup and the seated-leg/walking-bob drift regressions.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('docs/js/rig-transform-layers.js', 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'rig-transform-layers.js' });
const layers = sandbox.window.RigTransformLayers;
function rig() { return { position: { x: 0, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }; }
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-8, `${a} should equal ${b}`); }

{
  const node = rig();
  for (let frame = 0; frame < 600; frame++) {
    layers.setAxis(node, 'npc-move-bob', 'position', 'y', 0.3);
    near(node.position.y, 2.3); // Reapplying the same offset is idempotent.
  }
  layers.clear(node, 'npc-move-bob');
  near(node.position.y, 2);
  layers.setAxis(node, 'drunk-body', 'rotation', 'x', 0.25);
  layers.setAxis(node, 'yawn-body', 'rotation', 'x', -0.1);
  near(node.rotation.x, 0.15); // Independent temporary pose owners compose.
  layers.clear(node, 'drunk-body');
  near(node.rotation.x, -0.1);
  layers.clear(node, 'yawn-body');
  near(node.rotation.x, 0);
}
{
  const node = rig();
  for (let frame = 0; frame < 300; frame++) {
    layers.clear(node, 'npc-move-bob'); // At start of walker.update, before ground following.
    node.position.y += (2 - node.position.y) * 0.3;
    layers.setAxis(node, 'npc-move-bob', 'position', 'y', 0.24 * Math.sin(frame / 11));
  }
  layers.clear(node, 'npc-move-bob');
  near(node.position.y, 2); // Ground correction cannot permanently absorb bob.
}
{
  const node = rig();
  for (let frame = 0; frame < 240; frame++) {
    layers.clear(node, 'drunk-thigh-left'); // Before the procedural solver replaces the thigh.
    node.position.x += (0.4 - node.position.x) * 0.2; // Seated pose damping.
    layers.setPosition(node, 'drunk-thigh-left', { x: 0.2, y: -0.1, z: 0.05 });
  }
  layers.clear(node, 'drunk-thigh-left');
  near(node.position.x, 0.4);
  near(node.position.y, 2);
  near(node.position.z, 0);
}
{
  const node = rig();
  layers.setAxis(node, 'old-carry', 'rotation', 'x', 1.2);
  node.rotation.x = 0.4; // An absolute grab/recovery/blend owner replaces the old pose.
  layers.clear(node, 'old-carry'); // Never subtract 1.2 from the new animation.
  near(node.rotation.x, 0.4);
  layers.setAxis(node, 'new-action', 'rotation', 'x', 0.1);
  near(node.rotation.x, 0.5);
  layers.clear(node, 'new-action');
  near(node.rotation.x, 0.4);
  assert.ok(layers.getDebug().externalTakeovers >= 1);
}
{
  const node = rig();
  assert.equal(layers.setAxis(node, 'broken', 'position', 'y', Number.NaN), false);
  near(node.position.y, 2);
  layers.setPosition(node, 'paired', { x: 0.2, y: -0.4, z: 0.1 });
  layers.clearAll(node);
  near(node.position.x, 0);
  near(node.position.y, 2);
  near(node.position.z, 0);
  assert.equal(layers.getDebug().activeLayers, 0);
}
// Workshop loads runtime scripts independently from the gameplay loader.
const editorScripts = fs.readFileSync('docs/tools/enemy-loadout-editor/preview.js', 'utf8');
const ledgerAt = editorScripts.indexOf("'js/rig-transform-layers.js?v=");
const drunkAt = editorScripts.indexOf("'js/drunk-locomotion.js?v=");
assert.ok(ledgerAt >= 0 && drunkAt > ledgerAt, 'Workshop must load the rig ledger before drunken locomotion');
console.log('Rig transform layers: ownership, interrupts, drift, editor bootstrap and release PASS');
