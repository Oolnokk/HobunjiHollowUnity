const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('docs/js/wilderness-ai-snapshot.js', 'utf8'); // The lab harness lives beside the existing mobile-friendly Wilderness AI diagnostics.

assert(source.includes("const WILDERNESS_LAB_ZONE_ID = 'map_wilderness_lab'"),
  'handoff harness must be isolated to the Wilderness Chunk Lab');
assert(source.includes("document.getElementById('devPorakanekiChunkHandoffSpawnBtn')"),
  'Wilderness Chunk Lab must expose a dedicated Porakaneki spawn/arm button');
assert(source.includes("document.getElementById('devPorakanekiChunkHandoffCopyBtn')"),
  'handoff trace must have a dedicated copy button');
assert(source.includes('window.WildernessChunks?.snapshot?.()'),
  'test trigger must read the real wilderness chunk streamer');
assert(source.includes('window.WildernessChunks?.constants?.CHUNK_TILES'),
  "test chunk math must reuse the streamer's chunk size");
assert(source.includes('window.BanditCombat.makeEntity'),
  'materialization must use the production bandit-like entity builder');
assert(source.includes('speciesWeights: { porakaneki: 1 }'),
  'test builder must force Porakaneki species');
assert(source.includes("entity.state = 'return'"),
  'fresh test Porakaneki must enter the shared hostile loop in neutral return state');
assert(source.includes('entity._porakanekiPlannerControlled = true'),
  'fresh test Porakaneki must be marked as planner-controlled neutral AI');

const materializeStart = source.indexOf('async function materializeHandoffTest'); // Narrows ordering checks to the isolated LOD-to-live transaction.
const materializeEnd = source.indexOf('\n  function recordDueHandoffSamples', materializeStart); // End boundary for the materialization transaction under test.
const materialize = source.slice(materializeStart, materializeEnd); // Source slice used to guard publication order without running browser-only rendering code in Node.
const neutralize = materialize.indexOf('neutralizeHandoffEntity(entity);'); // Neutral state must exist before the shared hostile Set can observe the entity.
const publish = materialize.indexOf('deps.hostileObjects.add(entity);'); // Shared hostile-loop publication point checked against neutralization above.
assert(neutralize >= 0 && publish > neutralize,
  'neutralization must happen before publication to hostileObjects');
assert(materialize.includes("appendHandoffEvent(test, 'MAKE_ENTITY_RESOLVED'"),
  'trace must capture the builder result before handoff mutation');
assert(materialize.includes("appendHandoffEvent(test, 'PUBLISHED_TO_HOSTILE_LOOP'"),
  'trace must record hostile-loop publication');
assert(source.includes('renderDelta'),
  'trace must record simulation/render divergence');
assert(source.includes("appendHandoffEvent(test, 'PLAYER_CHUNK_CHANGED'"),
  'trace must record player chunk transitions while approaching the target');
assert(source.includes("appendHandoffEvent(test, 'TARGET_CHUNK_ENTERED'"),
  'trace must record the exact chunk-entry trigger');
assert(source.includes('navigator.clipboard.writeText(text)'),
  'trace must be copyable without DevTools');

console.log('Porakaneki Wilderness Chunk Lab handoff harness source checks passed.');
