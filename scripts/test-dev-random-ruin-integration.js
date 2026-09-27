#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const camera = read('docs/js/dev-random-ruin-bootstrap.js');
const motion = read('docs/js/dev-random-ruin-motion-runtime.js');
const coverage = read('docs/js/dev-random-ruin-runtime-coverage.js');
const api = read('docs/tools/debris-ifier/debrisifier-v50-api.js');
const debrisBootstrap = read('docs/tools/debris-ifier/debrisifier-01.js');
const debrisIndex = read('docs/tools/debris-ifier/index.html');
const debrisSource = read('docs/tools/debris-ifier/debrisifier-v50-source.js');
const embeddedTree = JSON.parse(read('docs/tools/debris-ifier/debrisifier-v50-embedded-tree.json'));
const interior = read('docs/js/dev-random-ruin-interior-map.js');
const occupancy = read('docs/js/dev-random-ruin-tile-occupancy.js');
const solvability = read('docs/js/dev-random-ruin-solvability.js');
const dynamicSurfaces = read('docs/js/dynamic-surfaces.js');
const hooks = read('docs/js/dev-random-ruin-prototype-hooks.js');
const renderProxy = read('docs/js/dev-random-ruin-wall-render-proxy.js');
const interactions = read('docs/js/dev-random-ruin-interactions.js');
const inputClaims = read('docs/js/world-action-input-claims.js');
const simplePuzzles = read('docs/js/dev-random-ruin-simple-puzzles.js');
const cloudFog = read('docs/js/cloud-forest-fog.js');
const gameIndex = read('docs/index.html');
const game = read('docs/game.js');
const climbSystem = read('docs/js/climb-system.js');
const audioSystem = read('docs/js/audio-system.js');

const loadOrder = [
  'dynamic-surfaces.js',
  'dev-random-ruin-hit-puzzles-loader.js',
  'dev-random-ruin-prototype-hooks.js',
  'dev-random-ruin-tile-occupancy.js',
  'dev-random-ruin-solvability.js',
  'dev-random-ruin-interior-map.js',
  'dev-random-ruin-motion-runtime.js',
  'dev-random-ruin-simple-puzzles.js',
  'dev-random-ruin-interactions.js',
  'dev-random-ruin-runtime-coverage.js',
].map(name => camera.indexOf(name));
assert(/localStorage\.getItem\('hobunjiDevMode'\) === '1'/.test(camera) && /if \(!devMode/.test(camera), 'ruin runtime must only be injected in Dev Mode');
assert(camera.includes('dev-random-ruin-interactions.js?v=20260927inputclaim1'), 'ruin interaction adapter must be cache-busted in the dev bootstrap');
assert(camera.includes('dev-random-ruin-simple-puzzles.js?v=20260927inputclaim1'), 'simple puzzle runtime must be cache-busted in the dev bootstrap');
assert(camera.includes('dev-random-ruin-wall-render-proxy.js?v=20260926glyphdecal1'), 'glyph decal proxy fix must be cache-busted in the dev bootstrap');
assert(gameIndex.includes('js/dev-random-ruin-bootstrap.js?v=20260927inputclaim1'), 'game page must load the updated ruin bootstrap');
assert(gameIndex.includes('game.js?v=20260927inputclaim1'), 'game page must load the shared world-input ownership integration');
assert(gameIndex.includes('js/climb-system.js?v=20260926ruinladder2'), 'game page must cache-bust the shared climb animation used by authored ruin ladders');
assert(loadOrder.every(index => index >= 0), 'ruin bootstrap must load every Random Test Ruin runtime module');
for (let i = 1; i < loadOrder.length; i++) {
  assert(loadOrder[i] > loadOrder[i - 1], 'Random Test Ruin runtime modules must preserve dependency order');
}

assert(interior.includes("const RUIN_TILE_SCALE = 2"), 'generated ruin must retain 2x horizontal cells');
assert(interior.includes("map_i_dev_random_ruin"), 'generated ruin must remain a real session-only interior map');
assert(interior.includes("wallStyle:'cavern'"), 'Random Test Ruin must opt into the existing cavern combat-interior classification');
assert(game.includes("_buildingScenes.get(area)?.wallStyle === 'cavern'"), 'game cavern classification must recognize a session building record with cavern wallStyle');
assert(game.includes("_isCavernBuildingArea(currentArea) && heldMode === 'tool'"), 'cavern interiors must expose normal tool/ranged action-arch buttons on mobile');
assert(interior.includes("natural.naturalizeMesh(object,'cliffs')"), 'generated ruin stone must use the exact ordinary-den NaturalSurfaceMaterials cliffs path');
assert(interior.includes('new THREE.Color(0x2a1a0a)'), 'generated ruin may retain the den-colored empty background while geometry stays unlit');
assert(!/new THREE\.(?:AmbientLight|DirectionalLight|PointLight|SpotLight|HemisphereLight)\(/.test(interior), 'Random Test Ruin must not create real Three.js lights');
assert(interior.includes('function applyUnlitRuinMaterials'), 'Random Test Ruin must normalize all generated materials at the runtime boundary');
assert(interior.includes("natural.naturalizeMesh(object,'cliffs')"), 'shared ruin stone must still use the exact cliff material path');
assert(interior.includes("materialTextureIdentity(material).includes('carved_smooth')"), 'V50 carved_smooth stone clones must be recognized even when they no longer share the wall material object');
assert(interior.includes("material.color.getHex?.()===0x545039"), 'V50 RUIN_STONE_FILL fallback must be recognized as legacy stone');
assert(interior.includes('legacyStoneMaterials'), 'material diagnostics must prove no old dark V50 stone texture remains after cliff conversion');
assert(interior.includes('spritePngSurface.makeMaterial(THREE,source.map||null'), 'non-stone lit V50 materials must use the same canonical unlit PNG material factory as cliffs');
assert(interior.includes('remainingLitMaterials'), 'material diagnostics must explicitly count any lit material that escapes normalization');
assert((cloudFog.match(/map_i_dev_random_ruin/g)||[]).length>=2, 'Random Test Ruin must opt into the shared den no-sky and den darkness/lantern classifications');
assert(gameIndex.includes('js/cloud-forest-fog.js?v=20260926devruindark2'), 'test-ruin darkness override must be cache-busted in the game page');
assert(camera.includes('dev-random-ruin-interior-map.js?v=20260927inputclaim1'), 'test-ruin generator/runtime changes must be cache-busted in the dev bootstrap');
assert(interior.includes('Solvability.audit'), 'candidate ruins must run the pre-entry solvability audit');
assert(interior.includes('MAX_SOLVABILITY_ATTEMPTS = 6'), 'unsolvable candidates must have a bounded deterministic retry budget');
assert(interior.includes('getLastSolvabilityAudit'), 'rejected seed diagnostics must remain inspectable without devtools');
assert(solvability.includes('function flood('), 'solvability audit must flood-fill actual runtime floor/support reachability');
assert(solvability.includes('canSolvePressurePlate'), 'solvability audit must validate push-block pressure-plate routes');
assert(solvability.includes('const reachable = flood(playerPoint);'), 'sequential push solvability must continue from the player\'s post-push region instead of restarting at the ruin entrance');
assert(solvability.includes('playerPoint = pushSide;'), 'sequential push solvability must carry the chosen interaction side into the next push step');
assert(solvability.includes('canSolveBrazier'), 'solvability audit must validate torch source/carry routes');
assert(solvability.includes('canSolveGlyphGroup'), 'solvability audit must validate required projectile targets');
assert(solvability.includes("bridge ON/OFF sequence reachable in order"), 'solvability audit must validate ordered bridge controls');
assert(solvability.includes('unsolvedMechanisms'), 'solvability audit must reject candidates with puzzle mechanisms that cannot be solved');
assert(interior.includes('linkedSignal?.userData?.solveProgress'), 'projectile glyph solveProgress must drive linked door/platform animation progress');
assert(interior.includes('__devRuinPhysicalDoorBlocker=false') && !interior.includes("id:'devruin-physical-door-'+m.id"), 'generated stone doors must stay on the single aggregate tile-occupancy collision path instead of registering duplicate per-door blockers');
assert(interior.includes("kind:'stoneDoor'") && interior.includes("'Open Stone Door'"), 'ungated stone doors must expose the standard ruin interaction list action');
assert(interior.includes("kind:'transitDoor'") && interior.includes("'Open Hallway Door'"), 'plain hallway exit doors must use the same WorldPopupText interaction-list path as other world objects');
assert(interior.includes('__devRuinTransitDoorState') && interior.includes('updateTransitDoors(dt)'), 'transit doors must own explicit closed/open runtime state so collision matches their visible panel');
assert(gameIndex.includes('js/world-action-input-claims.js?v=20260927inputclaim1'), 'shared world-input claim registry must load before gameplay dispatch');
assert(interactions.includes("control.claimAction1===true?'action1'") && interactions.includes('WorldActionInputClaims?.dispatch'), 'ruin interactions must opt into explicit Action 1 ownership and dispatch through the shared registry');
assert(interactions.includes('entry.nativeInput?null:(fixedIndex>=0?TOUCH_BUTTON_IDS[fixedIndex]:null)'), 'explicit Action 1 claims must own the matching touch button instead of becoming prompt-only');
assert(simplePuzzles.includes("claimAction1:true") && simplePuzzles.includes("label:'Grab Rope'"), 'rope grab must be able to replace weapon Action 1 while nearby');
assert(interior.includes("kind:'transitDoor'") && interior.includes("claimAction1:true"), 'hallway doors must be able to replace weapon Action 1 while nearby');
assert(game.includes("dispatchWorldInputClaim(actionId,'press','game-input')"), 'keyboard/controller gameplay dispatch must consult world-input claims before weapon actions');
assert(game.includes("dispatchWorldInputClaim(mouseAction,'press','desktop-mouse')"), 'desktop mouse weapon input must consult the same contextual claim registry');
assert(game.includes("dispatchWorldInputClaim(physicalInputAction,'press','touch-arch')"), 'touch action-arch input must consult the same contextual claim registry');

assert(interior.includes('m.manualFallback=true') && interior.includes("'Raise Stone Platform'"), 'moving daises must retain a manual traversal fallback even when a glyph also exists');
assert(solvability.includes('manual lift fallback reachable'), 'pre-entry audit must understand the simple-mode lift fallback');
assert(!debrisBootstrap.includes('runtimePuzzleBypass?1:'), 'disabled V50 puzzle families must leave mechanisms manual/closed rather than silently auto-solving them');
assert(debrisBootstrap.includes('skip standalone editor startup in embedded gameplay runtime'), 'hidden gameplay V50 must skip standalone editor startup work that is irrelevant to generation');
assert(debrisBootstrap.includes('selfTestNeedle') && debrisBootstrap.includes('selfTestReplacement'), 'standalone startup suppression must be an exact-string embedded patch, not a mutation of protected V50 source');
assert(debrisBootstrap.includes('headless embedded renderer') && debrisBootstrap.includes('window.__debrisEmbeddedRuntime?{setPixelRatio(){}'), 'hidden V50 generation must avoid creating a second WebGLRenderer beside the live game renderer');
assert(debrisBootstrap.includes('disable embedded preview RAF') && debrisBootstrap.includes("if(!window.__debrisEmbeddedRuntime)renderPreview();"), 'hidden V50 generation must not start the standalone preview RAF loop');
assert(debrisBootstrap.includes('headlessEmbeddedPreview: true'), 'embedded transport diagnostics must report headless preview mode');
assert(debrisBootstrap.includes("new XMLHttpRequest()") && debrisBootstrap.includes("request.open('GET', 'debrisifier-v50-source.js', false)"), 'hidden V50 source loading must be parser-blocking so game startup asset traffic cannot starve the generator fetch');
assert(debrisBootstrap.includes("request.open('GET', 'debrisifier-v50-api.js', false)") && debrisBootstrap.includes("sourceURL=debrisifier-v50-api.embedded.js"), 'hidden V50 API loading must be synchronous in the same iframe realm as its patched source');
assert(debrisBootstrap.includes("api.src = 'debrisifier-v50-api.js'"), 'standalone Debris-ifier usage must retain its ordinary external API script path');
assert(!/if \(embeddedRuntime\) \{\s*fetch\('debrisifier-v50-source\.js'/.test(debrisBootstrap), 'hidden V50 bootstrap must not regress to the starvation-prone async source fetch');
assert(debrisIndex.includes("event?.message||event?.error?.message"), 'hidden generator diagnostics must capture source/API execution errors, not only failed script URLs');
assert(debrisBootstrap.includes("glyphNicheNeedle") && debrisBootstrap.includes("hideDecals:false"), 'simple projectile glyphs must runtime-patch pillar-niche targets to keep their authored decals');
assert(debrisBootstrap.includes("glyphGlowNeedle") && debrisBootstrap.includes('THREE.AdditiveBlending'), 'activated projectile glyph decals must glow through the unlit material path instead of a scene light');
assert(debrisSource.includes("profile:'pillarHoused',hideDecals:true"), 'protected V50 source must retain its original concealed pillar-niche target behavior; the gameplay change belongs only in the runtime patch');
assert(debrisIndex.includes('debrisifier-01.js?v=20260927syncapi1'), 'hidden V50 runtime patch must be cache-busted for deterministic source/API bootstrap');
assert(renderProxy.includes('polygonOffset: source?.polygonOffset === true'), 'game-realm activator proxies must preserve decal polygon offset so markers do not disappear into stone');
assert(renderProxy.includes('source.blending != null') && renderProxy.includes('THREE.AdditiveBlending'), 'game-realm proxies must follow live glyph Normal/Additive blend changes');
assert(renderProxy.includes('glyphDecalProxyCount:') && renderProxy.includes('glowingGlyphDecalProxyCount:'), 'render diagnostics must prove glyph decal proxies exist and enter their glow state');
assert(renderProxy.includes("if(!rebuilt && !proxy?.userData?.devRuinRenderDynamic) continue"), 'static wall/arch proxies must be excluded from the per-frame sync loop');
assert(renderProxy.includes('now-lastProxySyncAt<33'), 'dynamic proxy synchronization must be capped near 30 Hz');
assert(renderProxy.includes('resolvedRoot.updateMatrixWorld?.(true)') && renderProxy.includes('copySourceWorldTransform(sourceObject, proxy, scene, true)'), 'dynamic proxy ticks must batch source/scene matrix updates once instead of once per activator mesh');
assert(interactions.includes('now-lastInteractionListAt>=80'), 'world interaction row reconstruction must be throttled off the render hot path');
assert(simplePuzzles.includes('now-lastBadgeAt<250'), 'simple puzzle diagnostics must not rewrite DOM every render frame');
assert(simplePuzzles.includes('const GRID_WALL_CLEARANCE = 0.52') && simplePuzzles.includes('const crossMargin = GRID_WALL_CLEARANCE'), 'safe-path pressure plates must stay inside the player-clear hallway lane instead of hugging collision walls');
assert(dynamicSurfaces.includes("const scope = options.scope == null ? null : String(options.scope)"), 'support sampling must support an exact scope filter for pre-entry audits');
assert(interior.includes("hobunji.devRandomRuinPuzzleOptions.v2"), 'simple-mode defaults must use a fresh storage version so old all-on puzzle settings cannot leak forward');
assert(interior.includes("pressurePlate:false") && interior.includes("brazier:false") && interior.includes("stackedObelisk:false") && interior.includes("linkedCubePillars:false") && interior.includes("nestedRoom:false"), 'fragile V50 puzzle families must default off in the simple first pass');
assert(interior.includes("glyphObelisk:true") && interior.includes("safePath:true") && interior.includes("ropeSwing:true") && interior.includes("hallwayTraps:true"), 'simple first pass must keep projectile targets and enable safe-path, rope, and hallway hazards');
assert(interior.includes("getRuntimeContext"), 'parent-runtime simple puzzles need the generated scene/metadata context without reaching into V50 internals');
assert(interior.includes('getPuzzleGenerationOptions') && interior.includes('setPuzzleGenerationOptions'), 'simple-mode Settings state must be directly inspectable/persistable for deterministic runtime tests');
assert(interior.includes("checkbox.addEventListener('change'"), 'each simple puzzle checkbox must commit directly instead of depending on delegated Settings events');
assert(interior.includes("DevRandomRuinSimplePuzzles?.ownsPlayerMotion?.()"), 'rope swing / ballistic release must temporarily own player motion without floor reconciliation fighting it');
assert(simplePuzzles.includes("anchorY=ceilingBase+wallHeight-.035"), 'rope anchors must use the authored room ceiling datum instead of floating at a derived mid-room height');
assert(simplePuzzles.includes("dev_ruin_swing_rope_ceiling_mount_"), 'rope traversal must render an explicit ceiling attachment');
assert(simplePuzzles.includes("inputAction:'dodge'") && simplePuzzles.includes("nativeInput:true"), 'rope jump-off prompt must advertise the canonical Dodge input without stealing an action slot');
assert(simplePuzzles.includes("label:'Grab Rope'") && simplePuzzles.includes("point:candidate.grabPoint"), 'idle ropes must expose the normal floating WorldPopupText interaction instead of relying on invisible auto-grab proximity');
assert(simplePuzzles.includes("String(door?.to)===String(hall.id)") && simplePuzzles.includes('approachAtMin'), 'safe-path reveal pedestal must derive the player-approach side from the actual room-to-hall doorway rather than always using the low-coordinate end');
assert(simplePuzzles.includes('ROPE_DESTINATION_RISE = .78') && simplePuzzles.includes('ROPE_GRAB_ABOVE_LAUNCH = .86'), 'rope traversal must visibly separate the unreachable destination height from the reachable launch-side grip height');
assert(simplePuzzles.includes('topRise:COMPOUND_ELEVATOR_TOP_RISE'), 'compound rope/elevator landing must start above ordinary step height so the rope has an obvious traversal purpose');
assert(simplePuzzles.includes('generatedMechanismId=nearestGeneratedStoneDoorMechanism(context,doorway)') && simplePuzzles.includes('reusesGeneratedDoor:!!generatedMechanismId'), 'ossuary/chord locks must reuse the generated doorway mechanism instead of stacking a second blocking door over it');
assert(simplePuzzles.includes("window.DevRandomRuin?.setMechanismTarget?.(module.generatedMechanismId,module.targetOpen?1:0)"), 'ossuary completion must open the same generated stone door that visually seals the room');
assert(interior.includes('mechanism.externalTarget=normalized') && interior.includes('if(hasExternalTarget)'), 'explicit modular door unlocks must override stale V50 puzzle signals and drive visible mechanism progress');
assert(simplePuzzles.includes("playObjectSfxKey?.('breakRock',1.45,.58)") && simplePuzzles.includes('playStoneUnlockKchunk();'), 'four-note completion must play an unmistakable low stone unlock cue');
assert(simplePuzzles.includes('CHORD_PITCHES = Object.freeze([1, 1.259921, 1.498307, 1.887749])'), 'the four chord pressure plates must retain four distinct authored pitch ratios');
assert(!simplePuzzles.includes("dev_ruin_rope_hazard_"), 'rope fall/burn zones must remain logical hazards and never render as red debug slabs near the ceiling');
assert(simplePuzzles.includes("recordModulePlacement('projectileHallwayTrap'"), 'hallway traps must be represented as reusable module placements');
assert(simplePuzzles.includes("recordModulePlacement('chordPressurePlates'"), 'musical pressure plates must be reusable in hallway or room slots');
assert(simplePuzzles.includes("recordModulePlacement('stoneCanopy'"), 'stone canopies must exist as independent modules instead of rope-only geometry');
assert(simplePuzzles.includes("recordModulePlacement('sarcophagusSpawner'"), 'sarcophagus skeleton spawners must exist as independent modules');
assert(simplePuzzles.includes("recordModulePlacement('lockableStoneDoor'"), 'lockable room doors must exist as independently wired modules');
assert(simplePuzzles.includes("recordModulePlacement('ceilingProjectileGlyph'"), 'ceiling projectile targets must exist as independent trigger modules');
assert(simplePuzzles.includes("recordModulePlacement('cyclingElevator'"), 'cycling elevators must exist as independent sunken-floor modules');
assert(simplePuzzles.includes('buildSwappableHallwayModules'), 'generic hallway slots must be able to choose non-trap modules');
assert(simplePuzzles.includes("recordModulePlacement('hallwayGlyphGate'"), 'the reusable ceiling glyph must also be eligible as a hallway replacement module');
assert(simplePuzzles.includes("buildCyclingElevatorModule(context,room,{startActive:true"), 'cycling elevators must also be eligible as standalone traversal machinery');
assert(simplePuzzles.includes('installModularProjectileHook'), 'reusable canopies and ceiling glyphs must share one ranged-projectile collision seam');
assert(simplePuzzles.includes('buildBalconyRopeElevatorComposer'), 'the long balcony/rope/elevator possibility must be composed from reusable modules');
assert(simplePuzzles.includes('occludePoint') && simplePuzzles.includes('crossX') && simplePuzzles.includes('crossZ'), 'a composed balcony canopy must size itself from the real balcony-to-target ray rather than being decorative only');
assert(simplePuzzles.includes('buildSunkenRoomShell'), 'the lower ossuary must use a reusable sunken-room shell rather than bespoke full-sequence geometry');
assert(simplePuzzles.includes("window.MinionCombat?.makeEntity?.({") && simplePuzzles.includes("speciesId:'harlyao-skeleton'"), 'sarcophagus modules must spawn the existing Harlyao Skeleton Minion class');
assert(simplePuzzles.includes('spawnedMinions:new Set()') && simplePuzzles.includes('disposeSpawnedMinion(entity)'), 'sarcophagus-spawned minions must be owned and torn down by the generated ruin run');
assert(game.includes('const dynamicSurfaceY = Number(c.surfaceYOverride?.())') && simplePuzzles.includes('creature.surfaceYOverride=()=>'), 'sarcophagus Minions must render against live ruin DynamicSurfaces instead of the flat building grid');
assert(simplePuzzles.includes('state===ownerState') && simplePuzzles.includes('ownerState.sarcophagusModules.includes(module)'), 'late async skeleton spawns must not leak across ruin rerolls');
assert(simplePuzzles.includes('KURRAYA_NOTE_URL') && simplePuzzles.includes('CHORD_PITCHES'), 'musical pressure plates must use the Kurraya pluck placeholder at authored chord pitches');
assert(simplePuzzles.includes('playGeneratedStoneKchunk'), 'four-note completion must expose a generated placeholder kchunk until a recorded cue replaces it');
assert(simplePuzzles.includes('opensUpstairsMechanism') && interior.includes('setMechanismTarget'), 'compound lower-room completion must be able to open an ordinary generated stone door upstairs');
assert(simplePuzzles.includes('onwardGeneratedStoneDoorMechanism') && simplePuzzles.includes('distance>best.distance'), 'compound completion must choose an onward door relative to the balcony instead of the nearest entrance-side door');
assert(simplePuzzles.includes('holsterRopeEquipment') && simplePuzzles.includes('putAwayHeldEquipment({silent:true})'), 'grabbing a rope must silently put away the current weapon/tool');
assert(simplePuzzles.includes('restoreHeldToolSnapshot') && simplePuzzles.includes('restoreRopeEquipment()'), 'rope release/fall/clear must restore the exact held tool snapshot');
assert(game.includes("DevRandomRuinSimplePuzzles?.releaseActiveRope?.()"), 'the canonical Dodge/context action must release an attached ruin rope');
assert(interactions.includes('if(row.nativeInput)continue') && interactions.includes('!entry.nativeInput && keyboardMatches'), 'fixed Dodge rope input must remain owned by native game input on controller/desktop');
assert(interactions.includes('if(row.nativeInput || !row.touchButtonId) return'), 'fixed Dodge rope input must keep the permanent mobile Dodge button instead of hijacking an action slot');
assert(interior.includes('devRandomRuinPuzzleOptions'), 'Random Test Ruin Settings must expose the collapsed puzzle-generation panel');
assert(interior.includes('data-ruin-puzzle-option'), 'puzzle-generation panel must render per-family checkboxes');
assert(interior.includes('devRandomRuinMaxPuzzlesPerRoom'), 'puzzle-generation panel must expose a per-room puzzle cap');
assert(interior.includes("DEFAULT_DARKNESS_SETTINGS = Object.freeze({ enabled:false, severity:1 })"), 'Random Test Ruin darkness must default off while retaining full authored severity');
assert(interior.includes('devRandomRuinDarknessEnabled') && interior.includes('devRandomRuinDarknessSeverity'), 'Random Test Ruin Settings must expose a darkness toggle and severity slider');
assert(interior.includes('getDarknessSettings'), 'Random Test Ruin must expose its live darkness settings to the shared lighting authority');
assert(cloudFog.includes("window.DevRandomRuin?.getDarknessSettings?.()"), 'shared enclosed lighting must consult the Random Test Ruin override');
assert(cloudFog.includes("testSettings?.enabled === true ? DEN_DARKNESS_OVERLAY_ALPHA * severity : 0"), 'test darkness must be zero by default and scale the authored den alpha when enabled');
assert(cloudFog.includes('refreshLightingOverlay'), 'test lighting controls must be able to redraw the existing lighting overlay immediately');
assert(interior.includes('puzzles:puzzleOptions'), 'Random Test Ruin generation must pass the captured puzzle options into every solvability retry');
assert(!interior.includes('devruin-wall-${object.id}'), 'wall meshes must not register object-wide blockers');
assert(!interior.includes('devruin-solid-${o.id}'), 'solid furniture must not register object-wide blockers');
assert(interior.includes("d.activatorType === 'stackedObelisk' || d.activatorType === 'linkedCubePillars'"), 'rotating cube towers must join the authoritative solid-object occupancy set');
assert(interior.includes("object.userData.blockerPurpose = 'puzzle_tower_' + d.activatorType"), 'tower collision sources must remain identifiable in Pixel Probe occupancy diagnostics');
assert(interior.includes("promptRoot:e.segment") && interior.includes("touchIcon:'↻'"), 'linked cube controls must expose explicit cube-level world prompt anchors and touch input');
assert(interior.includes("promptRoot:topSegment||a"), 'stacked rotating obelisks must anchor their world prompt above the cube tower');
assert(interior.includes('range:Number.isFinite(Number(control.range))'), 'per-control interaction range must survive the base provider export');
assert(interactions.includes('control.promptRoot || control.object'), 'shared ruin interactions must honor explicit tower prompt anchors');
assert(interactions.includes('horizontalDistanceToOwner'), 'tower interaction range must be measured from the physical object footprint rather than only its origin');
assert(interactions.includes("['simple', window.DevRandomRuinSimplePuzzles]"), 'simple runtime controls must join the same WorldPopupText interaction provider list');
assert(interactions.includes("typeof control.onHoldStart") && interactions.includes("onHoldEnd"), 'ruin input bridge must support held rope brake/adjust controls');
assert(interactions.includes("window.addEventListener('keyup'"), 'keyboard rope braking must receive an actual release event rather than becoming a toggle');
assert(interactions.includes("controller hold release failed"), 'controller rope braking must release on the falling edge');
assert(interactions.includes("pointercancel"), 'touch-held rope controls must release cleanly even when a gesture is cancelled');
assert(simplePuzzles.includes("'burningHealth',GRID_BURNING"), 'unsafe path plates must apply the existing Burning Health affliction');
assert(simplePuzzles.includes("'burningHealth',HALL_FIRE_BURNING") && simplePuzzles.includes("'poisonedHealth',HALL_POISON"), 'hallway emitters must alternate existing fire and poison afflictions');
assert(simplePuzzles.includes('safePathCells') && simplePuzzles.includes('GRID_REVEAL_MS'), 'safe-path grids must generate one continuous route and reveal it only temporarily');
assert(simplePuzzles.includes('devRandomRuinMandatoryTraversal') && simplePuzzles.includes('usedHallways.add(hall.id)'), 'safe-path grids must occupy a required hallway crossing rather than a bypassable room-center square');
assert(simplePuzzles.includes('updateAttachedRope') && simplePuzzles.includes('ROPE_GRAVITY') && simplePuzzles.includes('rope.omega'), 'rope traversal must use a real pendulum state rather than teleporting between platforms');
assert(simplePuzzles.includes("label:'Jump Off Rope'") && simplePuzzles.includes("inputAction:'dodge'") && simplePuzzles.includes("label:'Hold to Stop / Adjust Rope'"), 'rope controls must expose Dodge jump-off plus the held brake/adjust action');
assert(simplePuzzles.includes('rope.yaw+=intent.side') && simplePuzzles.includes('rope.length=Math.max'), 'held rope braking must allow reorientation and rope-length adjustment');
assert(simplePuzzles.includes('player?.inputX') && simplePuzzles.includes('player?.inputY') && simplePuzzles.includes('player?.inputStrength'), 'rope pumping/reorientation must consume the game-published movement intent rather than velocity the rope runtime zeroes');
assert(simplePuzzles.includes('doorwayCrossing') && simplePuzzles.includes("activateCheckpoint('ruin-entry'"), 'ruin entry and every doorway must feed session checkpoint tracking');
assert(game.includes("function respawnPlayer(reason = 'death')") && game.includes("window.DevRandomRuinSimplePuzzles?.respawnAtCheckpoint?.(reason)"), 'canonical respawnPlayer must offer every death source to the active ruin checkpoint before mine/totem/farm recovery while preserving its diagnostic reason');
assert(simplePuzzles.includes("if(!inRuin()||!state?.checkpoints?.active||!deps?.player)return false"), 'ruin checkpoint override must refuse deaths after the player has left the ruin');
assert(!simplePuzzles.includes('Combat.init.__devRandomRuinCheckpointWrapped') && !simplePuzzles.includes('PlayerVitals.init.__devRandomRuinCheckpointWrapped'), 'simple checkpointing must not stack fragile death-init wrappers around canonical respawn');
assert(simplePuzzles.includes("removeAffliction(player,id") && simplePuzzles.includes("player.health=Math.max(1,Math.round"), 'checkpoint respawn must clear lethal buildup and restore half Health');
assert(simplePuzzles.includes('HALL_SHOT_PERIOD') && simplePuzzles.includes('station.side *= -1'), 'hallway traps must fire in a steady alternating repeating pattern');
assert(simplePuzzles.includes('DS.addBeforeRenderClient(update)'), 'simple puzzles must share the game frame authority instead of starting their own RAF loop');
assert(interior.includes('TileOccupancy.create'), 'ruin must create the shared tile occupancy snapshot');
assert(interior.includes('getOccupancySnapshot'), 'ruin must expose the exact gameplay snapshot to diagnostics');
assert(occupancy.includes("const BLOCKER_ID = 'devruin-tile-occupancy'"), 'tile occupancy must own one aggregate gameplay blocker');
assert(occupancy.includes('if (!model.floorSet.has(tileKey)) result.add(tileKey);'), 'wall rasterization must place wall collision on the non-floor side');
assert(occupancy.includes('dataset.ruinFog = \'disabled\''), 'test ruin Map renderer must explicitly reveal the entire interior');
assert(occupancy.includes("'#e74c3c'"), 'Map renderer must draw blocked tiles red');
assert(occupancy.includes("'#35c96f'"), 'Map renderer must draw activator tiles green');
assert(occupancy.includes("'#3498db'"), 'Map renderer must draw mechanism tiles blue');
assert(occupancy.includes('doorIsClosed'), 'door collision must use logical open/closed state instead of rendered height');
assert(occupancy.includes('nearestFloorAnchor'), 'mechanism diagnostics must use compact logical anchor tiles');
assert(interior.includes('transitDoors:ruin.transitDoors'), 'transit doors must join the shared tile occupancy snapshot');
assert(interior.includes('motion === \'elevatorPushBlock\''), 'elevator push blocks must join dynamic tile occupancy');
assert(!interior.includes('if (d.elevatorWellSocket) furnitureBlockers.push(object);'), 'low elevator-well rims must not become full-height 2D blockers that prevent stepping onto moving platforms');
assert(renderProxy.includes("data.previewMotion?.type === 'stoneDoor'"), 'parent-realm render bridge must discover stone-door meshes');
assert(renderProxy.includes("add(mesh, 'doorArch', object)"), 'parent-realm render bridge must include complete stone arch frames');
assert(renderProxy.includes('normalizeDoorAssemblies'), 'door panels must be aligned to their matching arch and floor');
assert(renderProxy.includes("add(mesh, 'activator', object)"), 'parent-realm render bridge must discover linked activator meshes');
assert(renderProxy.includes('copySourceWorldTransform(sourceObject, proxy, scene)'), 'door and activator proxies must follow live V50 transforms');
assert(renderProxy.includes('visibleDoorProxies'), 'mobile diagnostics must expose visible door proxy coverage');
assert(renderProxy.includes('visibleActivatorProxies'), 'mobile diagnostics must expose visible activator proxy coverage');
assert(renderProxy.includes("natural.naturalizeMesh(proxy,'cliffs')"), 'visible parent-realm ruin proxies must retain the exact den cliffs material pipeline');
assert(renderProxy.includes('sourceUnlit = source?.isMeshBasicMaterial'), 'render proxy cloning must preserve unlit source materials instead of always creating MeshStandardMaterial');
assert(renderProxy.includes('spritePngSurface.makeMaterial(THREE,map'), 'unlit render proxies must use the same canonical PNG material factory as cliffs');
assert(renderProxy.includes('litProxyMaterials:'), 'render proxy diagnostics must expose any accidentally relit visible materials');
assert(interior.includes('tools/debris-ifier/index.html?devRuntime=1'), 'hidden generator must request embedded V50 runtime mode');
assert(interior.includes('await enterRuin(); updateBadge();'), 'generate must await the actual ruin transition midpoint before reporting success');
assert(interior.includes('const entering=ruin;'), 'ruin entry transition must capture the generated instance it is entering');
assert(interior.includes('if(!entering||ruin!==entering)return;'), 'stale ruin-entry transition callbacks must be identity-guarded');
assert(interior.includes('if(removeMap) removeGeneratorFrame();'), 'rerolls must retain the V50 iframe while full clear/leave removes it');
assert(interior.includes('restorePreviewRoots()'), 'reroll lifecycle comment must retain the V50 preview-root restore contract');
assert(hooks.includes("generatedAccessType === 'stoneLadder'"), 'prototype hook layer must discover V50 ladders');
assert(hooks.includes("motion === 'elevatorPushBlock'"), 'prototype hook layer must discover elevator push blocks');
assert(hooks.includes('moving-platform grounded child'), 'grounded moving-platform children must not produce false unhandled warnings');
assert(!hooks.includes('registerBlocker(`devruin-transit-door-'), 'transit doors must not retain a second object-wide blocker');
assert(!hooks.includes('registerBlocker(`devruin-elevator-'), 'elevator objects must not retain object-wide blockers outside the Map snapshot');
assert(interactions.includes("matchMedia?.('(pointer: coarse)')"), 'mobile ruin actions must recognize coarse-pointer desktop-view devices');
assert(interactions.includes("source:'semantic-glyph'"), 'mobile glyph targets must expose ranged guidance/action');
assert(interior.includes('function getPlayerSupportY()') && interior.includes('getPlayerSupportY') && interior.includes('syncPlayerPresentationHeight:syncRuinPresentationHeight'), 'multi-level ruin presentation must expose one authoritative support height to the normal player renderer');
assert(game.includes('window.DevRandomRuin?.getPlayerSupportY?.()') && game.includes('Number.isFinite(ruinStandY) ? ruinStandY'), 'game.js must consume ruin support before positioning body, shadow, resources, held equipment, and shoulder pets');
assert(interior.includes('ruin.supportY=climbY') && interior.includes('ruin.lastAcceptedPx={x:deps.player.x,y:deps.player.y}'), 'ladder motion must advance the ruin step baseline so the landing cannot be rejected as an oversized step');
assert(!interior.includes('RUIN_ELEVATION_CHANNEL'), 'ruin elevation must not post-correct attachments through a second composer channel');
assert(interactions.includes('ClimbSystem?.startScriptedWorldClimb'), 'authored stone ladders must use the shared cliff-climb animation instead of teleporting by default');
assert(climbSystem.includes('function startScriptedWorldClimb') && climbSystem.includes('startScriptedWorldClimb,'), 'ClimbSystem must expose the reusable staggered hop/lerp climb path');
assert(hooks.includes('DevRandomRuinInteractions owns the single climb control'), 'prototype hooks must not install a competing ladder action');
new vm.Script(interior, { filename:'dev-random-ruin-interior-map.js' });
new vm.Script(solvability, { filename:'dev-random-ruin-solvability.js' });
new vm.Script(dynamicSurfaces, { filename:'dynamic-surfaces.js' });
new vm.Script(occupancy, { filename:'dev-random-ruin-tile-occupancy.js' });
new vm.Script(renderProxy, { filename:'dev-random-ruin-wall-render-proxy.js' });
new vm.Script(interactions, { filename:'dev-random-ruin-interactions.js' });
new vm.Script(inputClaims, { filename:'world-action-input-claims.js' });
{
  const claimWindow={};
  vm.runInNewContext(inputClaims,{window:claimWindow,console});
  let presses=0,releases=0;
  claimWindow.WorldActionInputClaims.setClaims('test',[{actionId:'action1',label:'Test Interaction',priority:5,onPress:()=>presses++,onRelease:()=>releases++}]);
  assert.equal(claimWindow.WorldActionInputClaims.isClaimed('action1'),true,'registered world interaction must claim Action 1');
  assert.equal(claimWindow.WorldActionInputClaims.dispatch('action1','press',{source:'test'}),true,'claimed Action 1 press must be consumed');
  assert.equal(presses,1,'claimed press must invoke exactly once');
  assert.equal(claimWindow.WorldActionInputClaims.dispatch('action1','press',{source:'repeat'}),true,'repeated held press stays consumed');
  assert.equal(presses,1,'repeated held press must not double-fire the interaction');
  claimWindow.WorldActionInputClaims.clearClaims('test');
  assert.equal(claimWindow.WorldActionInputClaims.dispatch('action1','release',{source:'test'}),true,'release must remain paired to the original claim after proximity ownership clears');
  assert.equal(releases,1,'paired world interaction release must fire exactly once');
  assert.equal(claimWindow.WorldActionInputClaims.dispatch('action1','release',{source:'unmatched'}),false,'unmatched release must not suppress a weapon release');
}


assert(api.includes("root?.userData?.activatorType === 'glyphObelisk'") && api.includes('setDecalMaterialsProgress(root.userData.decalMaterials, normalizedProgress)'), 'direct projectile glyph progress must update its leaf decal state through the V50 API boundary');
assert(api.includes('createRuntimeStoneLadder'), 'V50 bridge must expose the real stone ladder constructor');
assert(api.includes('auditInteriorSeeds'), 'V50 bridge must expose multi-seed runtime-tag auditing');
assert(api.includes('inspectRuntimeTags'), 'V50 bridge must classify runtime-tagged prototype output');
assert(api.includes('prepareRuntimeWallPlanes'), 'V50 bridge must explicitly prepare the prototype wall planes for game rendering');
assert(api.includes('runtimeWallPlaneRendered'), 'prototype wall planes must be tagged after runtime render preparation');
assert(api.includes('THREE.DoubleSide'), 'prototype wall planes must render from either game-camera side');
assert(api.includes('runtimeHallwayState'), 'V50 bridge must expose generated hallway clearance metadata');
assert(api.includes('window.__devRuinPuzzleOptions = puzzleOptions'), 'V50 bridge must publish normalized puzzle options to the embedded source');
assert(api.includes('window.__devRuinPuzzleCounts = new Map()'), 'each generated ruin must start with a fresh per-room puzzle counter');
assert(api.includes('window.__devRuinPuzzleClaimedMechanisms = new Set()'), 'fallback activators must not double-count one mechanism against the room cap');
assert(api.includes('minCrossCells < 5'), 'embedded runtime must reject hallway width regressions below five prototype cells');
assert(!motion.includes('    ensureSunkenEgress();'), 'simplified ruins must not inject a second runtime ladder style');
assert(motion.includes('authoredLadderCount'), 'motion diagnostics must count the authored V50 stone ladders that now own traversal');
assert(motion.includes('ridesMovingDais'), 'motion runtime must carry V50 elevator blocks with moving daises');
assert(motion.includes('pushElevatorBlock'), 'elevator push blocks must remain interactable in-game');
assert(motion.includes('auditSeeds'), 'game-side motion runtime must expose isolated multi-seed auditing');
assert(coverage.includes("entry.activatorType === 'alwaysLitTorch'"), 'cross-layer audit must recognize V50 always-lit fuel torches');
assert(coverage.includes('registeredTorchSources'), 'always-lit audit coverage must be backed by actual Batch 2 torch-source discovery');
assert(coverage.includes('data.groundedToMovingPlatform && object?.parent'), 'platform-parented displays must be recognized as transform-driven');
assert(coverage.includes('effectiveUnhandled'), 'cross-layer audit must retain truly unhandled prototype objects');
assert(coverage.includes('filterSeedAudit'), 'multi-seed audit must reconcile known cross-layer activator classes');

// The recovered prototype file is immutable source-of-truth. Embedded mode reads
// these exact bytes and applies only verified in-memory game-runtime patches.
assert.equal(
  crypto.createHash('sha256').update(debrisSource).digest('hex'),
  '038a5d54c66b0ae2a9ceeb66967b9e5c32b616040f40b503eec59d5331885f40',
  'readable V50 source must remain byte-for-byte identical to the recovered prototype source',
);
assert(interior.includes('GENERATOR_FRAME_TIMEOUT_MS = 30000') && interior.includes('performance.now() - started < GENERATOR_FRAME_TIMEOUT_MS'), 'hidden V50 generation must retain a bounded but slow-browser-safe startup timeout');
assert(debrisBootstrap.includes("params.get('devRuntime') === '1'"), 'Debris-ifier bootstrap must recognize hidden dev runtime mode');
assert(debrisIndex.includes('window.__debrisEmbeddedRuntime&&parent!==window&&parent.THREE'), 'hidden Debris-ifier must reuse the already-loaded parent THREE realm without requiring WebGLRenderer or CDN fallback');
assert(debrisIndex.includes('window.__debrisUsedParentThree=true'), 'hidden generator dependency diagnostics must prove the parent THREE path was selected');
assert(interior.includes('usedParentThree:child?.__debrisUsedParentThree===true'), 'generator timeout diagnostics must expose whether local parent THREE was used');
assert(debrisBootstrap.includes("const EMBEDDED_TREE = 'debrisifier-v50-embedded-tree.json'"), 'embedded runtime must name the committed local tree');
assert(debrisBootstrap.includes('const hallReplacement = \'const width=randomIntInclusive(rng,5,6),length=randomIntInclusive(rng,5,8);\''), 'embedded runtime must widen normal V50 hallways to 5–6 cells');
assert(debrisBootstrap.includes("escapeHallReplacement = 'hallWidth=randomIntInclusive(rng,5,6),hallLen=10+rooms.length*3;'"), 'embedded runtime must widen fallback V50 hallways to 5–6 cells');
assert(debrisBootstrap.includes('Math.max(3,Number(door.widthCells)||3)'), 'hallway door arches must consume the authored doorway width instead of a fixed 3-cell span');
assert(debrisBootstrap.includes('Math.max(3,Number(chosen.door.widthCells)||3)'), 'focus doorway arches must consume the authored doorway width');
assert(debrisBootstrap.includes("new URL('../../'+fromDocsRoot,location.href).href"), 'embedded runtime must map repo asset paths to the local docs origin');
assert(debrisBootstrap.includes('refusing an unverified embedded patch'), 'embedded runtime patching must fail closed if exact V50 bindings drift');
assert(debrisBootstrap.includes("source.src = 'debrisifier-v50-source.js'"), 'direct Debris-ifier mode must keep loading the exact readable source file');
assert(debrisBootstrap.includes('patchedBindings: patches.length'), 'embedded runtime must report the verified patch count');
assert(debrisBootstrap.includes('runtimePuzzleFamilyEnabled'), 'embedded runtime must filter puzzle families without modifying V50 source');
assert(debrisBootstrap.includes('runtimePuzzleRoomAvailable'), 'embedded runtime must enforce the configured room puzzle cap');
assert(debrisBootstrap.includes('runtimePuzzleBypass'), 'capped/disabled puzzle mechanisms must be put in a solved bypass state');
assert(debrisBootstrap.includes('runtimeChoosePressureFallbackType'), 'pressure plates without a valid push route must fall back to another enabled puzzle family');
assert(debrisBootstrap.includes('invalid pressure-plate fallback'), 'embedded V50 patch set must include the pressure-route fallback seam');
assert(debrisBootstrap.includes('pressure-puzzle prior reserved space'), 'new pressure puzzles must avoid earlier reserved puzzle space');
assert(debrisBootstrap.includes('doorway flank push-route avoidance'), 'doorway flank pillars must not occupy reserved push corridors');
assert(debrisBootstrap.includes('wall display push-route avoidance'), 'wall displays must not occupy reserved push corridors');
assert(debrisBootstrap.includes('pressure prior-obstacle clearance'), 'pressure routes must honor full clearance reserved by earlier puzzle geometry');
assert(debrisBootstrap.includes('push reserved point footprint clearance'), 'push route point reservations must cover full block/socket footprint clearance');
assert(debrisBootstrap.includes('push reserved segment footprint clearance'), 'continuous push corridors must retain the same full footprint clearance');
assert(debrisBootstrap.includes('elevator socket authored exit'), 'nested elevator sockets must have a physical opening for the raised block');
assert(debrisBootstrap.includes('elevator socket first-push direction'), 'the socket opening must follow the generated first push direction');
assert(debrisBootstrap.includes("runtimePuzzleFamilyEnabled('nestedRoom')"), 'nested room chains must have an independent generation toggle');
assert(debrisBootstrap.includes("type==='linkedCubePillars'"), 'linked cube pillars must be selectable independently from simple rotating obelisks');
assert(debrisBootstrap.includes("bridgeSequence'){const p=activation"), 'bridge sequences must consume linked activation so solved/bypassed state reaches the bridge');
assert.equal((debrisSource.match(/REPO_RAW_ROOT/g) || []).length, 4, 'V50 source gained an unaudited direct raw-repo transport use');
assert(debrisSource.includes('const width=randomIntInclusive(rng,3,4),length=randomIntInclusive(rng,5,8);'), 'source-of-truth V50 hallway sizing unexpectedly changed');
assert(debrisSource.includes('hallWidth=randomIntInclusive(rng,3,4),hallLen=10+rooms.length*3;'), 'source-of-truth V50 fallback hallway sizing unexpectedly changed');
new vm.Script(debrisBootstrap, { filename:'debrisifier-01.js' });
new vm.Script(debrisSource, { filename:'debrisifier-v50-source.js' });
new vm.Script(api, { filename:'debrisifier-v50-api.js' });
new vm.Script(simplePuzzles, { filename:'dev-random-ruin-simple-puzzles.js' });
new vm.Script(interactions, { filename:'dev-random-ruin-interactions.js' });

const furnitureRoots = ['docs/config/furniture-authored/', 'docs/assets/models/furniture/data/'];
const ruinRe = /(pillar|stone|obelisk|ruin|statue|buttress|arch|pedestal|support)/i;
const treePaths = embeddedTree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path);
const furniturePaths = treePaths.filter(file => furnitureRoots.some(dir => file.startsWith(dir)) && /\.json$/i.test(file));
assert.equal(furniturePaths.length, 11, 'embedded V50 tree must contain the exact 11 ruin-friendly furniture paths');
assert(furniturePaths.every(file => ruinRe.test(path.basename(file))), 'embedded furniture manifest must contain only V50 ruin-friendly candidates');
assert(furniturePaths.includes('docs/config/furniture-authored/statue.json'), 'embedded candidate pool must retain authored statue furniture');
assert(furniturePaths.includes('docs/assets/models/furniture/data/pillar_square.json'), 'embedded candidate pool must retain authored square pillars');
assert(furniturePaths.includes('docs/assets/models/furniture/data/stone_arch.json'), 'embedded candidate pool must retain stone arches');
for (const asset of [
  'docs/assets/textures/carved_smooth.png',
  'docs/assets/textures/inn_sign_text.png',
  'docs/assets/textures/general_store_sign_text.png',
  'docs/assets/models/Roughbrick1.glb',
]) assert(treePaths.includes(asset), `embedded V50 tree must retain ${asset}`);
assert.equal(embeddedTree.truncated, false, 'embedded V50 tree must be complete');

const parts = [];
for (let i = 1; i <= 9; i++) {
  const id = String(i).padStart(2, '0');
  const text = read(`docs/js/dev-random-ruin-hit-puzzles-runtime/part${id}.js`);
  const match = text.match(/__devRuinHitParts\.push\('([^']*)'\);/);
  assert(match, `hit-puzzle part ${id} must contain one base64 payload`);
  parts.push(match[1]);
}
const hitSource = Buffer.from(parts.join(''), 'base64').toString('utf8');
assert(hitSource.startsWith('// Dev Random Test Ruin'), 'decoded hit-puzzle source header must be intact');
assert(hitSource.includes('window.DevRandomRuinHitPuzzles'), 'decoded hit runtime must export its public API');
assert(hitSource.includes('debugActivateGlyph(object = null)') && hitSource.includes('return target ? activateGlyph(target) : false'), 'hit runtime diagnostics must exercise the same authoritative glyph state transition as real projectile hits');
assert(hitSource.includes('TORCH_BURN_MS = 12000'), 'temporary ruin torch must retain its 12-second burn budget');
assert(hitSource.includes('harpoon_fishingmace.png'), 'temporary ruin torch must reuse the fishing-mace sprite');
assert(hitSource.includes('glyphObelisk'), 'decoded hit runtime must support projectile glyph targets');
assert(hitSource.includes('brazier'), 'decoded hit runtime must support physical brazier ignition');
assert(hitSource.includes('alwaysLitTorch'), 'decoded hit runtime must discover V50 always-lit reference torches as fuel sources');
assert(hitSource.includes('installRanged'), 'decoded hit runtime must install a ranged-projectile seam');
assert(hitSource.includes('installCombat'), 'decoded hit runtime must install its torch-sweep combat seam');
new vm.Script(hitSource, { filename: 'dev-random-ruin-hit-puzzles.js' });
new vm.Script(coverage, { filename: 'dev-random-ruin-runtime-coverage.js' });

assert(audioSystem.includes("if ('preservesPitch' in snd) snd.preservesPitch = false"), 'pitched object SFX must disable browser pitch preservation so playbackRate changes are audible as actual pitch changes');
assert(gameIndex.includes('js/audio-system.js?v=20260927pitchedsfx1'), 'pitched object-SFX fix must be cache-busted in the game page');
console.log('Random Test Ruin integration static audit passed.');
