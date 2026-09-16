const assert = require('node:assert/strict');
const fs = require('node:fs');

const cfg = JSON.parse(fs.readFileSync('docs/config/porakaneki-camp.json', 'utf8')); // LOD invariants remain owned by the camp config.
const runtime = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8'); // Camp runtime must still delegate locomotion to the shared hostile path.
const snapshot = fs.readFileSync('docs/js/wilderness-ai-snapshot.js', 'utf8'); // Mobile diagnostics must retain handoff visibility.
const gameSource = fs.readFileSync('docs/game.js', 'utf8'); // Guards the shared return locomotion plus render-sync path the live entity relies on.

assert(cfg.behavior.fullSimulationRadiusTiles > 0);
assert(cfg.behavior.fullSimulationReleaseRadiusTiles > cfg.behavior.fullSimulationRadiusTiles,
  'Porakaneki detailed-simulation LOD must use hysteresis');
assert(runtime.includes('distance <= (detailedEntityActive(hunter) ? fullSimulationReleaseRadiusTiles() : fullSimulationRadiusTiles())'),
  'LOD must be radial with the wider release radius for already-live residents');
assert(runtime.includes("entity.state = 'return'"),
  'neutral planner must delegate actual locomotion/rendering to the shared hostile return path');
assert(!runtime.includes('combatDeps.moveCreatureToward?.(entity'),
  'Porakaneki planner must not independently move the live entity alongside updateHostiles');
assert(runtime.indexOf('updateAllHunters(step, coarseStep);') < runtime.indexOf('updateTerritoryWarnings();'),
  'materialization must be attempted before territory warning delivery');
assert(runtime.includes('allowToastFallback: false'),
  'territory warnings must stay pending for Ambient Dialogue instead of degrading to a toast');
assert(snapshot.includes('renderDelta') && snapshot.includes('registered') && snapshot.includes('plannerControlled'),
  'mobile snapshot must expose render/simulation handoff diagnostics');

// hostileObjects is a Set in production (the dev arena, bandit camps, and wildlife spawners all use add/delete/has).
// These source guards make the old array-only Porakaneki registration path fail loudly in CI instead of being masked by a test double.
assert(runtime.includes('combatDeps.hostileObjects.add(entity)'),
  'materialized Porakaneki must register with the production hostile Set');
assert(runtime.includes('combatDeps.hostileObjects.delete(entity)'),
  'retired Porakaneki must leave the production hostile Set');
assert(runtime.includes('combatDeps?.hostileObjects?.has?.(entity)'),
  'mobile diagnostics must query registration with Set.has');
assert(!runtime.includes('hostileObjects.push(entity)'),
  'Porakaneki runtime must not use Array.push on the hostile Set');
assert(!runtime.includes('hostileObjects.splice('),
  'Porakaneki runtime must not use Array.splice on the hostile Set');
assert(!runtime.includes('hostileObjects?.includes?.(entity)'),
  'Porakaneki diagnostics must not use Array.includes on the hostile Set');

const neutralizeIndex = runtime.indexOf('makeNeutral(entity, hunter);'); // Publication ordering guard: no shared hostile frame may see the builder's default bandit state.
const registerIndex = runtime.indexOf('combatDeps.hostileObjects.add(entity);'); // Shared hostile Set publication point checked against neutralization above.
assert(neutralizeIndex >= 0 && registerIndex > neutralizeIndex,
  'materialized Porakaneki must be neutralized before publication to the shared hostile Set');

assert(gameSource.includes("} else if (c.state === 'return') {"),
  'game.js must retain the shared return-state branch used by neutral Porakaneki');
assert(gameSource.includes('moving = travelCreatureToward(c, c.homeX, c.homeY, def.moveSpeed, entityDt);'),
  'shared hostile return state must own Porakaneki simulation movement');
assert(gameSource.includes('updateCreatureMesh(c, entityDt, aimAngle);'),
  'shared hostile loop must continue synchronizing simulation movement into the PNG avatar');

console.log('Porakaneki materialization handoff regression checks passed.');
