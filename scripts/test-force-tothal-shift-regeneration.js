'use strict';

const assert = require('assert');
const fs = require('fs');

const game = fs.readFileSync('docs/game.js', 'utf8');
const index = fs.readFileSync('docs/index.html', 'utf8');

assert(game.includes('async function performTothalShift(year, { silent = false, forceRegenerate = false } = {})'),
  'performTothalShift must expose a forceRegenerate option');
assert(game.includes('const cached = forceRegenerate ? null : await _loadTothalZoneCache(cacheKey);'),
  'forced shifts must bypass the same-year IndexedDB zone cache');
assert(game.includes('const forceRegenerate = force || forceQuery;'),
  'button/query forcing must map to forceRegenerate');
assert(game.includes('performTothalShift(year, { silent, forceRegenerate })'),
  'checkTothalShift must pass forceRegenerate into generation');
assert(game.includes('return completionPromise;'),
  'checkTothalShift must return the completion promise so the Force button can actually await it');
assert(game.includes('async function refreshForcedTothalActiveZone(mapId)'),
  'forced shifts need an active-zone visual refresh path');
assert(game.includes("currentArea = 'town';") && game.includes('await enterZone(mapId, entryCol, entryRow);'),
  'active-zone refresh must leave the old scene before rebuilding and re-enter at the generated entry');
assert(index.includes('js/wilderness-map-generator.js?v=20260914b'),
  'generator script version must change so existing same-year caches are invalidated after the plateau export fix');

console.log('Force Tothal Shift regeneration regression passed.');
