const assert = require('node:assert/strict');
const fs = require('node:fs');

const cfg = JSON.parse(fs.readFileSync('docs/config/porakaneki-camp.json', 'utf8'));
const runtime = fs.readFileSync('docs/js/porakaneki-camps-runtime.js', 'utf8');
const snapshot = fs.readFileSync('docs/js/wilderness-ai-snapshot.js', 'utf8');

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

console.log('Porakaneki materialization handoff source regression checks passed.');
