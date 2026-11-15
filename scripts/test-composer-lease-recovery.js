'use strict';
// Exercises the actual compositor lease store without needing a WebGL context.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('docs/js/player-body-transform-composer.js', 'utf8');
let clock = 1000; // Controlled compositor clock used to simulate interrupted animations and long stalls.
const context = {
  channels: new Map(), // Real channel ledger evaluated from the production compositor.
  finite: (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback,
  performance: { now: () => clock },
};
vm.createContext(context);
const from = source.indexOf('  function setChannel(');
const to = source.indexOf('  function registerExternalRootProvider(');
assert(from !== -1 && to > from, 'lease store functions must remain in the composer');
vm.runInContext(source.slice(from, to), context);
const api = vm.runInContext('({ setChannel, clearChannel, clearAllChannels, touchChannel, expireStaleChannels, leaseRecovery })', context);

api.setChannel('run-lean', { mode: 'additive', leaseMs: 500, rotation: { pitch: 0.2 } });
api.setChannel('weapon-idle', { mode: 'additive', leaseMs: 500, rotation: { yaw: 0.3 } });
api.setChannel('ragdoll-hold', { mode: 'override', rotation: { pitch: 1.2 } }); // Legitimate held pose is not transient.
assert.equal(api.expireStaleChannels(1499), 0);
clock = 1490;
assert.equal(api.touchChannel('weapon-idle'), true); // Unchanged stance is revalidated without replacing its stored value.
assert.equal(context.channels.get('weapon-idle').expiresAtMs, 1990);
assert.equal(api.expireStaleChannels(1500), 1, 'abandoned run lean expires');
assert.equal(context.channels.has('run-lean'), false);
assert.equal(context.channels.has('weapon-idle'), true);
assert.equal(context.channels.has('ragdoll-hold'), true);
clock = 1900;
assert.equal(api.touchChannel('weapon-idle'), true, 'live idle pose is still renewable before its deadline');
clock = 2490;
assert.equal(api.touchChannel('weapon-idle'), false, 'an expired idle pose cannot be revived by touch');
assert.equal(context.channels.has('weapon-idle'), false, 'expired idle pose is removed before a new writer publishes it');
assert.equal(api.expireStaleChannels(2490), 0, 'expired channel is counted only once');
assert.equal(context.channels.has('ragdoll-hold'), true, 'held ragdoll pose must survive cleanup');

clock = 2200;
api.setChannel('crawl', { leaseMs: 500, absoluteYaw: 1.3 });
api.setChannel('crawl-weapon', { leaseMs: 500, translation: { y: -0.1 } });
assert.equal(api.expireStaleChannels(2700), 2, 'body and attachment leases expire together on interrupted crawl');
assert.equal(context.channels.size, 1);
assert.equal(api.leaseRecovery.expired, 4);
assert.equal(api.leaseRecovery.lastExpired, 'crawl-weapon');
assert.equal(api.touchChannel('missing-owner'), false, 'unknown owners cannot be silently revived');

api.setChannel('disabled-lease', { leaseMs: -200, rotation: { yaw: 0.1 } });
assert.equal(context.channels.get('disabled-lease').expiresAtMs, null);
api.setChannel('bounded-lease', { leaseMs: 90000 });
assert.equal(context.channels.get('bounded-lease').expiresAtMs, 7200, 'malformed leases are bounded');
assert.equal(api.clearChannel('bounded-lease'), true);
api.clearAllChannels();
assert.equal(context.channels.size, 0);

assert.match(source, /renderDebug\.expiredPoseChannels\s*=\s*expireStaleChannels\(renderDebug\.timestampMs\)/,
  'render entry must scrub orphaned channels before drawing');
assert.match(source, /function resolvedYawDeltaRad\(\)\s*\{\s*expireStaleChannels\(\)/,
  'head aim must never use a stale compositor yaw');
for (const path of [
  'docs/js/player-crawl.js',
  'docs/js/drunk-prone-composition-bridge.js',
  'docs/js/social-action-body-plane-runtime.js',
  'docs/js/livestock-harvest-staging.js',
  'docs/js/npc-yawn-rest.js',
]) {
  assert.match(fs.readFileSync(path, 'utf8'), /leaseMs:\s*500/, path + ' should expire an abandoned frame pose');
}
for (const path of ['docs/js/weapon-idle-body-yaw-runtime.js', 'docs/js/weapon-stance-drop-runtime.js']) {
  assert.match(fs.readFileSync(path, 'utf8'), /touchChannel\?\.\(CHANNEL\)/,
    path + ' must refresh a constant pose without publishing a duplicate each frame');
}
console.log('Composer pose lease recovery: interruption, refresh, persistent state and render scrub PASS');
