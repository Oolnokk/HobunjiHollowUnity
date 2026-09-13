'use strict';

const fs = require('fs'); // Used to inspect the standalone nearest-player and Pixel Probe adapters without booting the browser game.
const assert = require('assert'); // Used for zero-dependency source-structure checks.

const priority = fs.readFileSync('docs/js/environment-surface-near-priority.js', 'utf8');
const probe = fs.readFileSync('docs/js/environment-surface-pixel-probe.js', 'utf8');

assert.match(priority, /MIN_BOOT_DELAY_MS = 900/, 'priority pass must not lock onto transient boot coordinates immediately');
assert.match(priority, /PLAYER_SETTLE_MS = 250/, 'priority pass must require a short loaded-position settling window');
assert.match(priority, /chunkDistanceSq\(child, player\)/, 'spatial chunks must be ranked from their real bucket bounds to the player');
assert.match(priority, /source\.children = source\.children\.map/, 'priority pass must reorder only chunk slots under each renderer source');
assert.match(priority, /scene\.children\[sourceSlots\[i\]\] = orderedSources\[i\]/, 'terrain source wrappers must also be ordered nearest-first without moving non-source scene children');
assert.match(priority, /nearestSpatialChunk\(scene, player\)/, 'diagnostics must record the actual nearest chunk for the loaded player position');
assert.match(priority, /forceRebuild\?\.\('settled near-player spatial priority bootstrap'\)/, 'stale boot-position work must be cancelled and reseeded after the loaded position settles');
assert.match(priority, /RAIN_UPDATE_STALL_MS = 55/, 'watchdog must only assist after the normal rain-linked update cadence has actually stalled');
assert.match(priority, /runtime\.update\(\)/, 'RAF watchdog must be able to advance one bounded environment-surface slice when RainPlanes is not ticking');
assert.match(priority, /rainUpdateCalls\+\+/, 'adapter must count real RainPlanes updates so cadence is visible in diagnostics');
assert.match(priority, /assistUpdateCalls\+\+/, 'adapter must count watchdog-assisted runtime slices');
assert.match(priority, /priorUpdate\.call\(this, dt\)/, 'adapter must preserve the existing RainPlanes/environment surface update chain');
assert.match(probe, /LINE_PREFIX = 'Environment surface:'/, 'probe adapter must emit a stable copyable line');
assert.match(probe, /state\.pendingJobs/, 'probe line must expose pending work');
assert.match(probe, /state\.activeJob/, 'probe line must expose the active source job');
assert.match(probe, /state\.discoveredSpatialChunks/, 'probe line must expose spatial discovery');
assert.match(probe, /priority\.nearestChunk/, 'probe line must expose the nearest spatial chunk chosen at prioritization');
assert.match(probe, /priority\.priorityPlayer/, 'probe line must expose the player coordinates used for prioritization');
assert.match(probe, /priority\.rainUpdateCalls/, 'probe line must expose real RainPlanes update cadence');
assert.match(probe, /priority\.assistUpdateCalls/, 'probe line must expose watchdog-assisted snow updates');

console.log('Environment surface priority adapter checks passed.');
