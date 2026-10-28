// Maskbound Guardian: wooden skeleton-puppets animated by Hachutu binding magic.
// A troop definition owns its own anatomy and wood palette; never mutate the
// player/NPC species+gender defaults or the shared Mao'ao skeleton profile.
(() => {
  'use strict';

  const SPECIES_ID = 'maskbound-guardian'; // NPC-only skeleton species supplied by maskbound-guardian-species-runtime.js.
  const CLASS_ID = 'maskbound-guardian'; // Distinct hostile category in combat, loot and arena diagnostics.
  const MASK_ID = 'hachutu_binding_mask_ii'; // All guardians carry the authored binding mask.
  const SCREAM_URL = 'assets/audio/sfx/utterances/sfx_maskbound_scream.mp3'; // Sole combat utterance file; all effects derive from its playback.
  const VOICE_EVENTS = Object.freeze({
    breath: Object.freeze({ pitch: [-5, -1], tempo: [0.52, 0.82] }),
    charge: Object.freeze({ pitch: [-8, 1], tempo: [0.73, 1.1] }),
    strike: Object.freeze({ pitch: [-2, 7], tempo: [1.05, 1.55] }),
    pain: Object.freeze({ pitch: [-9, 5], tempo: [0.72, 1.35] }),
    dodge: Object.freeze({ pitch: [0, 8], tempo: [1.12, 1.65] }),
  }); // Independent pitch and tempo envelopes preserve variety across combat events.
  const TROOPS = Object.freeze({
    sentinel: Object.freeze({
      label: 'Maskbound Sentinel',
      anatomy: Object.freeze({ rigScaleX: 1.0, rigScaleY: 1.34, headScale: 0.88, headOffsetY: -0.07 }),
      gait: Object.freeze({ style: 'maskbound-lurch', dragSide: 'left', cadence: 0.82, stance: 0.65, dragLift: 0.13, lurchDegrees: 13 }), // Per-troop asymmetric foot timing, drag and torso lean.
      wood: '#443126',
      weapons: Object.freeze(['fishingspear', 'harlyaoLongsword']),
    }),
    bulwark: Object.freeze({
      label: 'Maskbound Bulwark',
      anatomy: Object.freeze({ rigScaleX: 1.62, rigScaleY: 1.02, headScale: 0.72, headOffsetY: -0.12 }),
      gait: Object.freeze({ style: 'maskbound-lurch', dragSide: 'right', cadence: 0.66, stance: 0.74, dragLift: 0.09, lurchDegrees: 19 }), // Per-troop asymmetric foot timing, drag and torso lean.
      wood: '#352419',
      weapons: Object.freeze(['warhammer', 'hatchet']),
    }),
    reacher: Object.freeze({
      label: 'Maskbound Reacher',
      anatomy: Object.freeze({ rigScaleX: 0.72, rigScaleY: 1.82, headScale: 1.16, headOffsetY: 0.12 }),
      gait: Object.freeze({ style: 'maskbound-lurch', dragSide: 'left', cadence: 0.92, stance: 0.62, dragLift: 0.22, lurchDegrees: 16 }), // Per-troop asymmetric foot timing, drag and torso lean.
      wood: '#503929',
      weapons: Object.freeze(['fishingspear', 'daggerSword']),
    }),
  }); // Distinct shapes and heights used by spawn, portrait tint, world collisions and in-game debugging.

  const clampChannel = value => Math.min(255, Math.max(0, Math.round(value))); // Keeps generated secondary wood shades in valid RGB range.
  function woodColors(hex) {
    const match = /^#([0-9a-f]{6})$/i.exec(String(hex)); // The troop palette is data, never executable/CSS input.
    const rgb = match ? [1, 3, 5].map(i => parseInt(match[1].slice(i - 1, i + 1), 16)) : [68, 49, 38];
    const shade = factor => '#' + rgb.map(channel => clampChannel(channel * factor).toString(16).padStart(2, '0')).join('');
    return {
      A: { hex: shade(1), tintMode: 'hexShadeFill' },
      B: { hex: shade(0.79), tintMode: 'hexShadeFill' },
      C: { hex: shade(0.59), tintMode: 'hexShadeFill' },
      HOOD: { hex: '#9b8063', tintMode: 'hexShadeFill' },
    };
  }

  function troopFor(type = 'sentinel') {
    const key = String(type || 'sentinel').toLowerCase();
    if (!Object.hasOwn(TROOPS, key)) throw new RangeError('Unknown maskbound guardian troop: ' + key);
    return { key, ...TROOPS[key] };
  }

  function rollRoster(type = 'sentinel') {
    const troop = troopFor(type); // The selected troop exclusively owns its proportions and base wood shade.
    const roster = window.MinionCombat?.rollRoster?.(SPECIES_ID, troop.label, { gender: 'male' });
    if (!roster) throw new Error('MinionCombat is required for maskbound guardian equipment.');
    roster.equippedCosmetics = [MASK_ID]; // Never pick the Minion's clothing pool or BanditCombat's forced headwear.
    roster.cosmeticSlots = { [MASK_ID]: 'hood' }; // Actual cosmetic slot, used in renderer and corpse loot.
    roster.appliedDyes = {}; // Wood coloration is an anatomy/body palette, not a removable cloth dye.
    roster.metalArmorItems = []; // Wooden puppets never inherit Harlyao's Town-Value armor set.
    roster.appearance.bodyColors = woodColors(troop.wood); // Also drives procedural hand/foot texture tint.
    roster.appearance.anatomy = { ...troop.anatomy }; // Save/diagnostic representation of the troop-scale input.
    roster.maskboundTroop = troop.key; // Reconstruction and future authored encounter placement use this identifier.
    roster.maskboundGait = { ...troop.gait }; // Passes per-troop walking data to the hostile avatar's procedural legs.
    return roster;
  }

  function voiceVariantFor(entity, event = 'strike') {
    const speciesId = entity?.rosterRecord?.appearance?.speciesId || entity?.appearance?.speciesId || entity?.speciesId;
    if (speciesId !== SPECIES_ID && entity?.isMaskboundGuardian !== true) return null;
    const kind = Object.hasOwn(VOICE_EVENTS, event) ? event : 'strike'; // Unknown action types still use the scream.
    const envelope = VOICE_EVENTS[kind]; // Every voice is drawn from the same clip at a new pitch and tempo.
    const troop = TROOPS[entity?.maskboundTroop || entity?.rosterRecord?.maskboundTroop] || TROOPS.sentinel;
    const range = bounds => bounds[0] + Math.random() * (bounds[1] - bounds[0]);
    const troopPitch = troop === TROOPS.bulwark ? -4 : troop === TROOPS.reacher ? 3 : 0; // Broad guardians growl; tall guardians shriek.
    const troopTempo = troop === TROOPS.bulwark ? 0.86 : troop === TROOPS.reacher ? 1.1 : 1; // Mass changes the scream's rhythm.
    return {
      url: SCREAM_URL,
      pitchOffsetSemitones: range(envelope.pitch) + troopPitch,
      tempoMultiplier: range(envelope.tempo) * troopTempo,
      event: kind,
    };
  }

  function rigScaleFor(troop) {
    const scale = window.HobunjiCharacterRigScale?.scaleFor?.(SPECIES_ID, 'male', { anatomy: troop.anatomy });
    if (!scale) throw new Error('CharacterRigScale is required for maskbound guardian proportions.');
    return scale; // Canonical x/y/head/offsetY validation is shared with species/gender defaults.
  }

  async function makeEntity(options = {}) {
    const troop = troopFor(options.troopType || options.roster?.maskboundTroop);
    const roster = options.roster || rollRoster(troop.key); // Rehydrated enemies can supply their existing loot/equipment record.
    const rigScale = rigScaleFor({ anatomy: roster.appearance?.anatomy || troop.anatomy });
    const entity = await window.MinionCombat?.makeEntity?.({
      ...options,
      speciesId: SPECIES_ID,
      name: roster.name || troop.label,
      roster,
      weaponShapePool: options.weaponShapePool || troop.weapons,
      enemyClass: CLASS_ID,
      shamblingFootingFraction: 0, // A magically driven wooden puppet is not a Harlyao Shambling Minion.
      avatarRigScale: rigScale,
      extra: { ...(options.extra || {}), isMaskboundGuardian: true, maskboundTroop: troop.key },
    });
    if (!entity) return null;
    entity.isMaskboundGuardian = true;
    entity.maskboundTroop = troop.key;
    entity.maskboundRigScale = { ...rigScale }; // Mobile-visible confirmation of the shape used in the 3D renderer.
    entity.maskboundGait = { ...(roster.maskboundGait || troop.gait) }; // Copyable per-troop gait values for mobile diagnostics.
    return entity;
  }

  const formatDebug = entity => {
    const troop = entity?.maskboundTroop || '-';
    const scale = entity?.avatarRef?.rigScale || entity?.maskboundRigScale;
    const shape = scale ? [scale.x, scale.y, scale.head, scale.offsetY].map(n => Number(n).toFixed(2)).join('/') : 'missing';
    const mask = entity?.rosterRecord?.equippedCosmetics?.includes(MASK_ID) ? 'yes' : 'no';
    const gait = entity?.avatarRef?.legs?.getStandingPoseDebug?.()?.gait; // Uses live leg solver's mobile diagnostic snapshot.
    return `Maskbound: type=${troop} bodyX/Y/head/neck=${shape} mask=${mask} gait=${gait?.style || 'pending'} cadence=${gait?.cadenceHz?.toFixed?.(2) || 'pending'} voice=maskboundscream tint=${entity?.rosterRecord?.appearance?.bodyColors?.A?.hex || 'missing'}`;
  }; // In-game testing arena and Pixel Probe may surface this without console access.

  window.MaskboundGuardianCombat = Object.freeze({
    classId: CLASS_ID, speciesId: SPECIES_ID, maskId: MASK_ID,
    troopTypes: TROOPS, troopFor, woodColors, rollRoster, rigScaleFor, voiceSource: SCREAM_URL, voiceVariantFor, makeEntity, formatDebug,
  });
})();
