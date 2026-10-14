#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const editor = read('docs/tools/attack-animation-editor/index.html');
const grips = read('docs/js/hand-tool-grips.js');
const animations = read('docs/js/held-action-animations.js');
const bandits = read('docs/js/combat/combat-bandit.js');
const camps = read('docs/js/bandit-camps.js');
const cfg = JSON.parse(read('docs/config/bandits/bandit-gang-config.json'));
const loot = JSON.parse(read('docs/config/loot/loot-pools.json'));
const attackValues = JSON.parse(read('docs/config/combat/attack-values.json'));
const enemyDodge = read('docs/js/combat/combat-enemy-dodge.js');

assert.match(editor, /throwingflask:\s*\{[^\n]*throwing_flask\.png/, 'Attack Editor tool catalog exposes the authored throwing flask sprite');
assert.match(editor, /id: 'flask_throw'[^\n]*heldAnimationKey: 'throwFlask'[^\n]*toolKey: 'throwingflask'/, 'Flask action selects the throwing-flask tool and shared throw animation');
assert.match(animations, /const throwFlask = weaponThrowSpin;/, 'flasks reuse the exact hatchet spin-throw animation object');
assert.match(grips, /throwingflask:\s*\{[\s\S]*?toolScale: 0\.82[\s\S]*?primaryGrip:[\s\S]*?x: -0\.03[\s\S]*?y: -0\.04[\s\S]*?z: -0\.0929[\s\S]*?yaw: -90/, 'throwing flask uses the authored normal grip export');
assert.match(grips, /throwingflask:\s*\{[\s\S]*?rangedPrimaryGrip:[\s\S]*?x: -0\.01[\s\S]*?y: -0\.05[\s\S]*?z: -0\.09[\s\S]*?yaw: 0/, 'throwing flask uses the independently authored ranged throw grip export');
assert.match(grips, /throwingflask:\s*\{[\s\S]*?heightMultiplier: 0\.5[\s\S]*?primaryGripSpan: \{ enabled: false, startZ: 0, endZ: 0 \}/, 'throwing flask retains the authored height multiplier and disabled primary span');
assert.match(grips, /key\.includes\('flask'\).*return 'throwingflask'/, 'real alchemy flask item keys normalize onto the authored grip');
assert.equal(cfg.gangComposition.flaskersMin, 1);
assert.equal(cfg.gangComposition.flaskersMax, 2);
assert.equal(cfg.flasker.loadoutSize, 2, 'Flaskers always carry two distinct flask recipe types');
assert.equal(cfg.rangedWeaponChanceByRank.flasker, 0, 'Flaskers reserve their ranged role for alchemy flasks');
assert.equal(cfg.flasker.lootMinPerType, 2);
assert.equal(attackValues.bandit.enemyDodge.chanceByRank.flasker, 0.44, 'Flasker dodge chance lives in the existing singular bandit config');
assert.equal(attackValues.bandits, undefined, 'no dead plural bandits config block is introduced');
assert.match(enemyDodge, /\['grunt', 'flasker', 'lieutenant', 'captain'\]/, 'authored Flasker dodge chance is actually consumed');
assert.ok(loot.pools.bandit_flasker, 'Flasker base corpse pool exists');
assert.match(bandits, /banditRank !== 'flasker'/, 'Bandit AI has a first-class Flasker branch');
assert.match(bandits, /throwFromEntity\(c, pendingRecipeId/, 'Flasker AI launches through the shared alchemy flask projectile system');
assert.match(bandits, /c\._banditSwingPose = throwAnimation\.poses/, 'Flasker render pose consumes the shared hatchet throw animation poses');
assert.match(bandits, /BANDIT_FLASK_SPRITE\s*=\s*['"]assets\/objectsprites\/throwing_flask\.png['"]/, 'Flasker visual uses the actual throwing-flask sprite');
assert.match(bandits, /function makeBanditFlaskToolHolder\(/, 'Flaskers build a dedicated inventory-flask holder instead of pretending the flask is a tool definition');
assert.match(bandits, /flaskActive[\s\S]*?_banditFlaskToolHolder[\s\S]*?BANDIT_FLASK_TOOL_KEY/, 'procedural hands and held-item rendering switch to the authored flask grip during throws');
assert.match(bandits, /beginStagedAction\(\{[\s\S]*?flasker: true/, 'Flasker throws use the same staged-action timer authority as other bandit attacks');
assert.match(camps, /grantFlaskerLoadoutLoot\(c, parts\)/, 'corpse looting grants the exact Flasker loadout types');
assert.match(camps, /reserveByRank: \{ grunt: 0, flasker: 0, lieutenant: 0, captain: 0 \}/, 'camp lifecycle tracks Flaskers beside the existing ranks');
console.log('ok: throwing flask editor grip + Flasker bandit integration');

const vm = require('node:vm'); // Executes the Flasker decision and normal visual teardown without WebGL.
let flaskStarts = 0; // Counts actual staged-action requests.
const aiContext = {window:{AlchemyFlasks:{throwFromEntity(){}},HeldActionAnimations:{throwFlask:{poses:{},durationS:1}},Combat:{beginStagedAction(spec){flaskStarts++;return {spec};}}},deps:{TILE:64},finishBanditAction(){}}; // Runtime seams for the isolated owner function.
vm.createContext(aiContext);
vm.runInContext(bandits.slice(bandits.indexOf('  function updateBanditFlaskAI('),bandits.indexOf('  function makeBanditDef(')),aiContext);
const flasker = {banditRank:'flasker',x:0,y:0,_banditFlaskIndex:0,def:{banditFlaskLoadout:['venom'],banditFlaskerTuning:{minThrowRangeTiles:2.25,maxThrowRangeTiles:10,throwCooldownSeconds:2}}}; // Player has backed away into throwing range.
const meleeAction = {name:'active-melee'}; // The existing action must remain owned by its original staged callback.
flasker._banditAction=meleeAction;
assert.equal(aiContext.updateBanditFlaskAI(flasker,.016,{x:192,y:0},192),null);
assert.equal(flasker._banditAction,meleeAction);
assert.equal(flaskStarts,0);
flasker._banditAction=null;
flasker._banditLunging=true;
assert.equal(aiContext.updateBanditFlaskAI(flasker,.016,{x:192,y:0},192),null);
flasker._banditLunging=false;
assert(aiContext.updateBanditFlaskAI(flasker,.016,{x:192,y:0},192).handled);
assert.equal(flaskStarts,1,'finished melee can hand off to a flask throw');

const game = read('docs/game.js'); // Normal despawn, which the fallback cleanup delegates to.
const cleanupEvents = []; // Check removal and GPU resource disposal exactly once.
const holder = {parent:{remove(){cleanupEvents.push('remove');}},traverse(fn){fn({geometry:{dispose(){cleanupEvents.push('geometry');}},material:{map:{dispose(){cleanupEvents.push('texture');}},dispose(){cleanupEvents.push('material');}}});}}; // Dedicated per-Flasker texture ownership.
const cleanupContext = {window:{CombatVocalizations:{forgetEntity(){cleanupEvents.push('voice');}}},scene:{remove(){}}}; // Minimal regular presentation owner dependencies.
vm.createContext(cleanupContext);
vm.runInContext(game.slice(game.indexOf('      function disposeCreaturePresentation('),game.indexOf('      // ── Loot & Shop config')),cleanupContext);
const discarded = {avatarRef:{group:{},dispose(){}},_banditFlaskToolHolder:holder}; // Otherwise already-empty creature presentation.
cleanupContext.disposeCreaturePresentation(discarded);
cleanupContext.disposeCreaturePresentation(discarded);
assert.equal(discarded._banditFlaskToolHolder,null);
for(const event of ['remove','geometry','texture','material']) assert.equal(cleanupEvents.filter(value=>value===event).length,1,event+' released exactly once');

const deathContext = {window:{},performance:{now:()=>0}}; // Exercise real death transition rather than searching for a hide statement.
vm.runInNewContext(read('docs/js/creature-death.js'),deathContext);
deathContext.window.CreatureDeath.init({TILE:64,COLS:10,ROWS:10,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),canOccupyAt:()=>false,corpseObjects:new Set()});
const dying = {x:64,y:64,health:0,_banditFlaskToolHolder:{visible:true},avatarRef:{group:{scale:{y:1}}}}; // Kill during a visible flask animation.
deathContext.window.CreatureDeath.begin(dying);
assert.equal(dying._banditFlaskToolHolder.visible,false,'death immediately hides the flask');
