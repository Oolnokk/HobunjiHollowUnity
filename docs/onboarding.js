// Hobunii Hollow — Player character creation onboarding
// Adapted from ScratchbonesGame NPC portrait editor (appearance + collections tabs).
// Fires CustomEvent 'hobunjiPlayerReady' with playerData when the player confirms.
(function () {
  'use strict';

  const STORAGE_KEY    = 'hobunjiPlayerProfile';
  const SAVE_META_KEY  = 'hobunjiSaveMeta';

  // ── Species / cosmetic slot definitions ──────────────────────────────────
  // Adapted from ScratchbonesGame BASE_SPECIES_DATA.
  function bodyPalette(speciesId, gender) {
    return window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.bodyPalettes?.[speciesId]?.[gender] || [];
  }

  const SPECIES_DATA = {
    'mao-ao': {
      label: 'Mao-ao', genders: ['male', 'female'],
      male: {
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_smooth_striped',    label: 'Smooth Striped' },
            { id: 'appearance::Mao-ao_M::mao-ao_tuft',              label: 'Tuft' },
            { id: 'appearance::Mao-ao_M::mao-ao_forwardtuft_short', label: 'Forward Tuft (Short)' },
            { id: 'appearance::Mao-ao_M::mao-ao_forwardtuft_long',  label: 'Forward Tuft (Long)' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_splayedknot_medium', label: 'Splayed Knot' },
            { id: 'appearance::Mao-ao_M::mao-ao_long_ponytail',      label: 'Long Ponytail' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_shoulder_length_drape', label: 'Shoulder Drape' },
            { id: 'appearance::Mao-ao_M::mao-ao_braid-R',               label: 'Braid (Right)' },
            { id: 'appearance::Mao-ao_M::mao-ao_braidcluster-R',        label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_braid-L', label: 'Braid (Left)' },
          ]},
          { slot: 'eyes', label: 'Eyes', options: [
            { id: null,  label: 'Default' },
            { id: 'appearance::Mao-ao_M::mao-ao_circled_eyes',   label: 'Circled Eyes' },
            { id: 'appearance::Mao-ao_M::mao-ao_circled_eye_L',  label: 'Circled Eye (L)' },
          ]},
          { slot: 'facialHair', label: 'Facial Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_wildbeard', label: 'Wild Beard' },
          ]},
        ],
        colorOptions: bodyPalette('mao-ao', 'male'),
      },
      female: {
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_smooth_striped',    label: 'Smooth Striped' },
            { id: 'appearance::Mao-ao_F::mao-ao_tuft',              label: 'Tuft' },
            { id: 'appearance::Mao-ao_F::mao-ao_forwardtuft_short', label: 'Forward Tuft (Short)' },
            { id: 'appearance::Mao-ao_F::mao-ao_forwardtuft_long',  label: 'Forward Tuft (Long)' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_splayedknot_medium', label: 'Splayed Knot' },
            { id: 'appearance::Mao-ao_F::mao-ao_long_ponytail',      label: 'Long Ponytail' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_shoulder_length_drape', label: 'Shoulder Drape' },
            { id: 'appearance::Mao-ao_F::mao-ao_braid-R',               label: 'Braid (Right)' },
            { id: 'appearance::Mao-ao_F::mao-ao_braidcluster-R',        label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_braid-L', label: 'Braid (Left)' },
          ]},
          { slot: 'eyes', label: 'Eyes', options: [
            { id: null,  label: 'Default' },
            { id: 'appearance::Mao-ao_F::mao-ao_circled_eyes',   label: 'Circled Eyes' },
            { id: 'appearance::Mao-ao_F::mao-ao_circled_eyes_f', label: 'Circled Eyes (F)' },
            { id: 'appearance::Mao-ao_F::mao-ao_circled_eye_L',  label: 'Circled Eye (L)' },
          ]},
        ],
        colorOptions: bodyPalette('mao-ao', 'female'),
      },
    },
    // Lore name "Slagothim" — same species, just referred to by that name
    // in design discussion; the internal id/label stays 'tletingan'.
    'tletingan': {
      label: 'Tletingan', genders: ['male'],
      male: {
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_forwardtuft_short', label: 'Forward Tuft (Short)' },
            { id: 'appearance::Tletingan_M::tl_forwardtuft_long',  label: 'Forward Tuft (Long)' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_longponytail', label: 'Long Ponytail' },
            { id: 'appearance::Tletingan_M::tl_splayedknot',  label: 'Splayed Knot' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_braid-R',        label: 'Braid (Right)' },
            { id: 'appearance::Tletingan_M::tl_braidcluster-R', label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_braid-L', label: 'Braid (Left)' },
          ]},
          { slot: 'facialHair', label: 'Facial Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Tletingan_M::tl_wildbeard', label: 'Wild Beard' },
          ]},
        ],
        colorOptions: bodyPalette('tletingan', 'male'),
      },
    },
    'kenkari': {
      label: 'Kenkari', genders: ['male', 'female'],
      male: {
        forcedCosmetics: { eyes: 'kenk_eyedisks' },
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_forwardtuft_long', label: 'Forward Tuft (Long)' },
            { id: 'appearance::Kenkari_M::kenk_fowardtuft',       label: 'Forward Tuft' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_splayedknot_high_m', label: 'Splayed Knot (High)' },
            { id: 'appearance::Kenkari_M::kenk_splayedknot_low_m',  label: 'Splayed Knot (Low)' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_braid-R_m',        label: 'Braid (Right)' },
            { id: 'appearance::Kenkari_M::kenk_braidcluster-R_m', label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_braid-L_m', label: 'Braid (Left)' },
          ]},
          { slot: 'facialHair', label: 'Facial Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_M::kenk_wildbeard', label: 'Wild Beard' },
          ]},
        ],
        colorOptions: bodyPalette('kenkari', 'male'),
      },
      female: {
        forcedCosmetics: { eyes: 'none' },
        slots: [
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_F::kenk_longponytail_f',     label: 'Long Ponytail' },
            { id: 'appearance::Kenkari_F::kenk_splayedknot_high_f', label: 'Splayed Knot (High)' },
            { id: 'appearance::Kenkari_F::kenk_splayedknot_low_f',  label: 'Splayed Knot (Low)' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_F::kenk_braid-R_f',        label: 'Braid (Right)' },
            { id: 'appearance::Kenkari_F::kenk_braidcluster-R_f', label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Kenkari_F::kenk_braid-L_f', label: 'Braid (Left)' },
          ]},
        ],
        colorOptions: bodyPalette('kenkari', 'female'),
      },
    },
    'engh-sho': {
      label: 'Engh-sho', genders: ['male', 'female'],
      male: {
        forcedCosmetics: { eyes: 'appearance::Engh-sho_M::engh_snowgoggles' },
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_tuft',              label: 'Tuft' },
            { id: 'appearance::Mao-ao_M::mao-ao_forwardtuft_short', label: 'Forward Tuft (Short)' },
            { id: 'appearance::Mao-ao_M::mao-ao_forwardtuft_long',  label: 'Forward Tuft (Long)' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_splayedknot_medium', label: 'Splayed Knot' },
            { id: 'appearance::Mao-ao_M::mao-ao_long_ponytail',      label: 'Long Ponytail' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_shoulder_length_drape', label: 'Shoulder Drape' },
            { id: 'appearance::Mao-ao_M::mao-ao_braid-R',               label: 'Braid (Right)' },
            { id: 'appearance::Mao-ao_M::mao-ao_braidcluster-R',        label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_braid-L', label: 'Braid (Left)' },
          ]},
          { slot: 'facialHair', label: 'Facial Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_wildbeard', label: 'Wild Beard' },
          ]},
        ],
        colorOptions: bodyPalette('engh-sho', 'male'),
      },
      female: {
        forcedCosmetics: { eyes: 'appearance::Engh-sho_F::engh_snowgoggles' },
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_tuft',              label: 'Tuft' },
            { id: 'appearance::Mao-ao_F::mao-ao_forwardtuft_short', label: 'Forward Tuft (Short)' },
            { id: 'appearance::Mao-ao_F::mao-ao_forwardtuft_long',  label: 'Forward Tuft (Long)' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_splayedknot_medium', label: 'Splayed Knot' },
            { id: 'appearance::Mao-ao_F::mao-ao_long_ponytail',      label: 'Long Ponytail' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_shoulder_length_drape', label: 'Shoulder Drape' },
            { id: 'appearance::Mao-ao_F::mao-ao_braid-R',               label: 'Braid (Right)' },
            { id: 'appearance::Mao-ao_F::mao-ao_braidcluster-R',        label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_F::mao-ao_braid-L', label: 'Braid (Left)' },
          ]},
        ],
        colorOptions: bodyPalette('engh-sho', 'female'),
      },
    },
    'mashtzarr': {
      label: 'Mashtzarr', genders: ['male'],
      male: {
        slots: [
          { slot: 'hairFront', label: 'Front Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_tuft',              label: 'Tuft' },
            { id: 'appearance::Mao-ao_M::mao-ao_forwardtuft_short', label: 'Forward Tuft (Short)' },
            { id: 'appearance::Mao-ao_M::mao-ao_forwardtuft_long',  label: 'Forward Tuft (Long)' },
          ]},
          { slot: 'hairBack', label: 'Back Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_splayedknot_medium', label: 'Splayed Knot' },
            { id: 'appearance::Mao-ao_M::mao-ao_long_ponytail',      label: 'Long Ponytail' },
          ]},
          { slot: 'hairSide', label: 'Side Hair (R)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_shoulder_length_drape', label: 'Shoulder Drape' },
            { id: 'appearance::Mao-ao_M::mao-ao_braid-R',               label: 'Braid (Right)' },
            { id: 'appearance::Mao-ao_M::mao-ao_braidcluster-R',        label: 'Braid Cluster (Right)' },
          ]},
          { slot: 'hairSideL', label: 'Side Hair (L)', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mao-ao_M::mao-ao_braid-L', label: 'Braid (Left)' },
          ]},
          { slot: 'facialHair', label: 'Facial Hair', options: [
            { id: null,  label: 'None' },
            { id: 'appearance::Mashtzarr_M::mashtz_wildbeard', label: 'Wild Beard' },
          ]},
        ],
        colorOptions: bodyPalette('mashtzarr', 'male'),
      },
    },
  };

  // Clothing slots for collections tab (mirrors scratchbones shop catalog categories)
  const CLOTHING_SLOTS = [
    { key: 'hat',      label: '🎩 Hat',      category: 'hat' },
    { key: 'hood',     label: '🧣 Hood',     category: 'hood' },
    { key: 'torso',    label: '👘 Torso',    category: 'torso' },
    { key: 'overwear', label: '🧥 Overwear', category: 'overwear' },
  ];
  const CLOTHING_USES_B = new Set(['rugged_poncho', 'fine_poncho', 'fine_hood']);

  // ── Module state ──────────────────────────────────────────────────────
  let _state       = null;
  let _cosmetics   = null;
  let _cosLoading  = false;
  let _activeTab   = 'appearance';
  let _colorAIdx   = 0;
  let _colorBIdx   = 0;
  // Clothing dye choice (Collections tab) — deliberately separate from
  // _colorAIdx/_colorBIdx (the body/fur color picker in the Appearance tab).
  // Previously clothing silently reused whichever body-color swatch was
  // selected there; null here means "use the first starter dye" (see
  // selectedClothDye) rather than defaulting to a body color at all.
  let _clothDyeAId = null;
  let _clothDyeBId = null;
  let _el          = null;
  let _renderTimer = null;

  // Save/load screen state
  let _saveMeta    = null;   // loaded hobunjiSaveMeta object
  let _selCharId   = null;   // selected character id in save-select
  let _selWorldId  = null;   // selected world id, or 'new' for new world
  let _newWorldName = '';    // in-progress name typed for a not-yet-created world
  let _flowStep    = null;   // 'save-select' | 'char-create'

  // ── Utilities ─────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function deriveCFromA(a) {
    return {
      h: a.h,
      s: Math.max(-1, Math.min(1, a.s + 0.05)),
      v: Math.max(-1, Math.min(1, a.v + 0.18)),
    };
  }

  function closestColorIdx(opts, target) {
    if (!opts?.length || !target) return 0;
    let best = 0, bestD = Infinity;
    opts.forEach((o, i) => {
      const d = Math.abs(o.h - target.h) * 0.5 + Math.abs(o.v - target.v) * 100;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function bodyColorSwatchBase(speciesId) {
    const key = speciesId || _state?.appearance?.speciesId;
    const normalizedKey = String(key || '').replace(/_/g, '-');
    const cfgSpecies = window.SCRATCHBONES_CONFIG?.game?.appearanceEditor?.species || {};
    return SPECIES_DATA[key]?.swatchBase
      || SPECIES_DATA[normalizedKey]?.swatchBase
      || cfgSpecies[key]?.swatchBase
      || cfgSpecies[normalizedKey]?.swatchBase
      || window.SCRATCHBONES_CONFIG?.game?.portrait?.tinting?.legacyBodySwatchFallbackBase
      || window.SCRATCHBONES_CONFIG?.game?.dyes?.swatchBase;
  }

  // Dyes a new character starts with for free, independent of any species'
  // body-color palette — the "Dusty" variant of every hue family, plus a
  // handful of practical neutrals (see scratchbones-config.js's dyes.catalog
  // acquisition field; everything else is mystery-pool-gated).
  function starterClothDyes() {
    return (window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || []).filter(d => d.acquisition === 'starter');
  }

  // Resolves the clothing dye actually chosen for tint slot 'A' or 'B' —
  // falls back to the first starter dye so clothing always has some color
  // even before the player has touched the picker.
  function selectedClothDye(which) {
    const dyes = starterClothDyes();
    const id = which === 'B' ? _clothDyeBId : _clothDyeAId;
    return dyes.find(d => d.id === id) || dyes[0] || null;
  }

  function swatchStyle(h, s, v, speciesId) {
    const hueOffset   = (window.SCRATCHBONES_CONFIG?.clothingHueOffset)   ?? 0;
    const satOffset   = (window.SCRATCHBONES_CONFIG?.clothingSatOffset)   ?? 0;
    const lightOffset = (window.SCRATCHBONES_CONFIG?.clothingLightOffset) ?? 0;
    const sat = Math.max(0, 1 + (Number(s) || 0) + satOffset);
    const bri = Math.max(0, 1 + (Number(v) || 0) + lightOffset);
    const finalH = (Number(h) || 0) + hueOffset;
    return `background:${bodyColorSwatchBase(speciesId)};filter:hue-rotate(${finalH}deg) saturate(${sat}) brightness(${bri})`;
  }

  // ── Persistence ───────────────────────────────────────────────────────
  function saveProfile(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  // ── Save Meta (multi-save system) ─────────────────────────────────────
  function makeSaveMeta() {
    return { version: 1, characters: [], worlds: [] };
  }

  function loadSaveMeta() {
    try { const r = localStorage.getItem(SAVE_META_KEY); return r ? JSON.parse(r) : null; } catch (_) { return null; }
  }

  function saveSaveMeta(m) {
    try { localStorage.setItem(SAVE_META_KEY, JSON.stringify(m)); } catch (_) {}
  }

  function uid(pfx) {
    return pfx + '_' + Math.random().toString(36).slice(2, 10);
  }

  // Hidden multiplayer-ready player identity — generated once at character
  // creation and never shown in any UI. Distinct from the character's local
  // save-slot id so a real network identity can be layered in later without
  // touching save-slot bookkeeping.
  function genPlayerId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return 'player_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function specLabel(sid) {
    return SPECIES_DATA[sid]?.label ?? (sid ? String(sid) : 'Unknown');
  }

  function relDate(ts) {
    if (!ts) return 'never';
    const d = Date.now() - ts;
    if (d < 60000)    return 'just now';
    if (d < 3600000)  return Math.floor(d / 60000) + 'm ago';
    if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
    return Math.floor(d / 86400000) + 'd ago';
  }

  function makeDefaultGear() {
    return {
      // Weakest verdigris metal (Native Copper, tier 1 of 7 — see game.js's
      // VERDIGRIS_METAL_KEYS/METAL_DEFS/toolMetalMultiplier) rather than the
      // old unscaled legacy keys, which fought at a flat, mid-hierarchy 1.0x
      // multiplier with no room to grow into.
      tools:    { hoe_nativeCopper: true, hatchet_nativeCopper: true, fishingmace_nativeCopper: true, fishingspear_nativeCopper: true, pickshovel_nativeCopper: true },
      clothing: { hat: null, hood: null, torso: null, overwear: null },
      charms: [], whistles: [],
      // Redye system: every dye the character has ever unlocked (see
      // docs/tools' dye catalog under game.dyes.catalog). Starts with the
      // same free "Dusty" hue + neutral set offered at character creation —
      // see starterClothDyes() — so freely redyeing clothing in-game never
      // has fewer options than the picker already shown here.
      dyeCollection: starterClothDyes().map(d => d.id),
      // Mirrors game.js's own makeDefaultGear() — see combat-progression.js
      // for how toolMastery drives per-tool ability upgrades, and
      // toolPlating/toolReinforcement for Sloomi/Kzubug's cosmetic plating
      // and metal-reinforcement services. No starting stipend for motes —
      // earned through play (or the loadout page's dev-mode +1 button).
      toolMastery: {},
      toolPlating: {},
      toolReinforcement: {},
      motesOfProwess: 0,
    };
  }

  function makeClothingItem(catalogItem, colorA, colorB) {
    const usesB = CLOTHING_USES_B.has(catalogItem.id);
    const dyeLabel = usesB && colorB ? (colorA.label + ' & ' + colorB.label) : colorA.label;
    return {
      cosmeticId: catalogItem.id,
      slot:       catalogItem.category,
      label:      dyeLabel + ' ' + catalogItem.label,
      baseLabel:  catalogItem.label,
      colorA:     { h: colorA.h, s: colorA.s, v: colorA.v, hex: colorA.hex, dyeId: colorA.dyeId, label: colorA.label },
      colorB:     usesB && colorB ? { h: colorB.h, s: colorB.s, v: colorB.v, hex: colorB.hex, dyeId: colorB.dyeId, label: colorB.label } : null,
    };
  }

  function makeDefaultSkills() {
    return { combat: 0, farming: 0, fishing: 0, foraging: 0, alchemy: 0, cooking: 0 };
  }

  // Character stats — plain persisted values with no gameplay effect yet.
  function makeDefaultStats() {
    return { deadliness: 0, control: 0, agility: 0, stamina: 0, intelligence: 0, resistance: 0 };
  }

  // Default per-character-in-this-world data. This is world-scoped: it stays
  // behind when a character leaves the world, unlike gear/skills/stats which
  // travel with the character between worlds.
  function makeDefaultMemberState() {
    return {
      nonGearInventory: {},           // general resource inventory (seeds/crops/gold/etc.)
      packClothing:     [],           // unequipped clothing sitting in this world's pack
      npcRelationships: {},           // { [npcId]: { favor, memory: [{event, day, ts}] } }
      questProgress:    {},           // { [questId]: { status, progress, completedAt } }
      alcoholBottleSwigs: {},         // { [itemKey]: remainingSwigs } for the currently open bottle in each stack
      npcAlcoholState: {},            // { [npcId]: { sobriety, blackoutUntilMinute, lastDrinkKey } }
      alchemyKnownEffects: {},        // { [reagentKey]: [effectIndex, ...] } — discovered reagent effects
      alchemyActiveEffects: [],       // [{ key, remainingS }] — still-active buffs/debuffs at last save
      alchemyReagentState: {},        // { [zoneMapId]: { day, placements: [{col,row,key}] } }
      joinedAt:         Date.now(),
    };
  }

  // Default farmhand permission flags. The world owner always has full
  // permissions implicitly and is never represented in the farmhands list.
  // 'livestock' gates adding creatures to the farm and setting/breaking
  // breeding pairs — separate from 'alterFarm' (till/plant/dig) since a
  // farmhand may be trusted with crops but not with the animals.
  function makeDefaultFarmhandPermissions() {
    return { storage: false, plant: false, harvest: false, placeFurniture: false, alterFarm: false, livestock: false };
  }

  function makeDefaultWorld(characterId) {
    const world = {
      id:                uid('world'),
      label:             'Hobunji Hollow',
      ownerCharacterId:  characterId,
      farmhands:         [],   // [{ characterId, permissions }] — non-owner members with farm access grants
      members:           {},   // { [characterId]: memberState } — world-scoped data per character who has joined
      livestock:         [],   // [{ id, kind, col, row, releasedAt, name, genotype }] — belongs to the world itself, not any character
      breedingPairs:     [],   // [{ id, parentA, parentB, startedDay, readyDay }] — parentA/B are { source: 'world'|'stable', id, characterId? } refs; resolved on day-tick
      storage:           {},   // { [itemKey]: count } — shared farm storage pool, world-scoped like livestock
      keyItems:          [],
      lastDay:           1,
      lastSeason:        'Stormtide',
      createdAt:         Date.now(),
      lastPlayed:        Date.now(),
    };
    world.members[characterId] = makeDefaultMemberState();
    return world;
  }

  // ── World ownership / membership helpers ────────────────────────────────
  function isWorldOwner(world, characterId) {
    return !!world && world.ownerCharacterId === characterId;
  }

  function getFarmhandEntry(world, characterId) {
    return (world?.farmhands || []).find(f => f.characterId === characterId) || null;
  }

  // Owner gets implicit full permissions; farmhands get whatever's been granted.
  function getFarmhandPermissions(world, characterId) {
    if (isWorldOwner(world, characterId)) {
      return { storage: true, plant: true, harvest: true, placeFurniture: true, alterFarm: true, livestock: true };
    }
    return { ...makeDefaultFarmhandPermissions(), ...(getFarmhandEntry(world, characterId)?.permissions || {}) };
  }

  function ensureWorldMember(world, characterId) {
    if (!world.members) world.members = {};
    if (!world.members[characterId]) world.members[characterId] = makeDefaultMemberState();
    return world.members[characterId];
  }

  function addFarmhand(world, characterId, permissions) {
    if (!world.farmhands) world.farmhands = [];
    if (isWorldOwner(world, characterId)) return;
    let entry = getFarmhandEntry(world, characterId);
    if (!entry) {
      entry = { characterId, permissions: makeDefaultFarmhandPermissions() };
      world.farmhands.push(entry);
    }
    if (permissions) Object.assign(entry.permissions, permissions);
    ensureWorldMember(world, characterId);
  }

  function removeFarmhand(world, characterId) {
    world.farmhands = (world.farmhands || []).filter(f => f.characterId !== characterId);
  }

  function setFarmhandPermission(world, characterId, permission, value) {
    const entry = getFarmhandEntry(world, characterId);
    if (entry) entry.permissions[permission] = !!value;
  }

  // Worlds a character can currently open — worlds they own plus worlds
  // they've joined as a farmhand.
  function worldsForCharacter(meta, characterId) {
    return (meta.worlds || []).filter(w =>
      w.ownerCharacterId === characterId || (w.farmhands || []).some(f => f.characterId === characterId)
    );
  }

  // Local worlds this character neither owns nor has joined — the pool the
  // save-select screen's "Join a Local World" section offers, so a second
  // character (this player's own alt, until real networking exists) can
  // preview what joining a friend's farm as a farmhand would feel like.
  function otherLocalWorlds(meta, characterId) {
    return (meta.worlds || []).filter(w =>
      w.ownerCharacterId !== characterId && !(w.farmhands || []).some(f => f.characterId === characterId)
    );
  }

  // ── Default state ─────────────────────────────────────────────────────
  function makeDefaultState(speciesId, gender) {
    speciesId = speciesId || 'mao-ao';
    gender    = gender    || 'male';
    const spec = SPECIES_DATA[speciesId] || SPECIES_DATA['mao-ao'];
    if (!spec.genders.includes(gender)) gender = spec.genders[0];
    const gData = spec[gender];
    const opts  = gData?.colorOptions || [];
    const base  = opts[0] || { h: 0, s: -0.70, v: -0.30 };
    return {
      nickname: '',
      appearance: {
        speciesId,
        gender,
        cosmetics: {},
        bodyColors: {
          A: { h: base.h, s: base.s, v: base.v },
          B: { h: base.h, s: base.s, v: base.v },
          C: deriveCFromA(base),
        },
      },
      equippedCosmetics: [],
      appliedDyes:       {},
    };
  }

  function currentGenderData() {
    return _state ? SPECIES_DATA[_state.appearance.speciesId]?.[_state.appearance.gender] : null;
  }

  // ── Portrait rendering ────────────────────────────────────────────────
  async function ensureCosmetics() {
    if (_cosmetics) return _cosmetics;
    if (_cosLoading) return null;
    _cosLoading = true;
    try {
      if (window.setPortraitAssetBase) window.setPortraitAssetBase('./assets/');
      if (window.loadPortraitCosmetics) _cosmetics = await window.loadPortraitCosmetics('./config/');
    } catch (e) {
      console.warn('[onboarding] cosmetics load failed:', e);
    }
    _cosLoading = false;
    return _cosmetics;
  }

  // Build a portrait profile from current _state using the same approach as
  // the ScratchbonesGame NPC portrait editor's buildPreviewProfile().
  function buildPreviewProfile() {
    const cosm = _cosmetics;
    if (!cosm || !window.getPortraitFighters || !window.randomPortraitProfileSeeded) return null;
    const ap = _state.appearance;
    const { speciesId, gender, cosmetics: saved, bodyColors } = ap;
    const {
      optionCache, hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions,
      eyesOptions, upperFaceOptions, facialHairOptions, hatOptions, hoodOptions,
      torsoPortraitOptions, armPortraitOptions, bodyColorRangesByGender,
      allowedCosmeticsByFighter, cosmeticWeightsByFighter,
      forcedCosmeticsByFighter, conditionalCosmeticsByFighter,
      mandatoryCosmeticSlotsByFighter, exclusiveCosmeticsByFighter,
    } = cosm;

    const fighters = window.getPortraitFighters();
    if (!fighters?.length) return null;

    const norm = s => s.replace(/-/g, '_');
    const fighterGender = f => f.gender ?? (f.id === 'M' ? 'male' : f.id === 'F' ? 'female' : null);
    const fighter = fighters.find(f =>
      (f.speciesId === speciesId || f.speciesId === norm(speciesId)) && fighterGender(f) === gender
    ) || fighters[0];
    if (!fighter) return null;

    let rngS = 0x9e3779b9;
    const rng = () => {
      rngS = (Math.imul(rngS ^ (rngS >>> 16), 0x45d9f3b) >>> 0);
      rngS = (Math.imul(rngS ^ (rngS >>> 16), 0x45d9f3b) >>> 0);
      return (rngS >>> 0) / 0x100000000;
    };

    const profile = window.randomPortraitProfileSeeded(
      rng, [fighter],
      hairFrontOptions, hairBackOptions, hairSideOptions, hairSideLOptions,
      eyesOptions, upperFaceOptions, facialHairOptions, bodyColorRangesByGender,
      allowedCosmeticsByFighter, hatOptions, hoodOptions, cosmeticWeightsByFighter,
      torsoPortraitOptions, armPortraitOptions, forcedCosmeticsByFighter, conditionalCosmeticsByFighter, undefined,
      mandatoryCosmeticSlotsByFighter, exclusiveCosmeticsByFighter
    );
    if (!profile) return null;

    // Apply saved cosmetic selections
    const forced      = forcedCosmeticsByFighter?.[fighter.id] ?? {};
    const forcedSlots = new Set(Object.keys(forced));
    const mandatorySlots = new Set(mandatoryCosmeticSlotsByFighter?.[fighter.id] || []);
    const exclusiveBySlot = exclusiveCosmeticsByFighter?.[fighter.id] || {};
    const isAllowedSavedCosmetic = (slot, id) => {
      const exclusive = exclusiveBySlot?.[slot];
      return !Array.isArray(exclusive) || !exclusive.length || exclusive.includes(id);
    };
    const lookup      = id => id ? (optionCache?.get(id) ?? null) : null;
    for (const [slot, key] of Object.entries({
      hairFront: 'hairFront', hairBack: 'hairBack', hairSide: 'hairSide', hairSideL: 'hairSideL',
      eyes: 'eyes', upperFace: 'upperFace', facialHair: 'facialHair',
    })) {
      if (saved[slot] === undefined || forcedSlots.has(slot) || !isAllowedSavedCosmetic(slot, saved[slot])) continue;
      if (slot === 'upperFace' && mandatorySlots.has(slot) && (!saved[slot] || saved[slot] === 'none')) continue;
      profile[key] = lookup(saved[slot]);
    }
    if (bodyColors) profile.bodyColors = { ...(profile.bodyColors || {}), ...bodyColors };

    // Apply equipped clothing (collections tab)
    const catalog    = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
    const equipped   = _state.equippedCosmetics;
    const none       = { id: 'none', tintSlot: null, layers: [] };
    const resolveVar = (cat, eqId) => {
      if (!eqId) return null;
      const base = catalog.find(i => i.id === eqId);
      if (!base) return eqId;
      const cands = catalog.filter(i =>
        i.category === cat && i.label === base.label &&
        (i.material || null) === (base.material || null) &&
        i.species === speciesId && (!i.gender || i.gender === gender)
      );
      return [eqId, ...cands.map(i => i.id)].find(id => optionCache?.has(id)) ?? eqId;
    };
    const applyEquip = (cat, key, fallback) => {
      const eqId = catalog.find(i => i.category === cat && equipped.includes(i.id))?.id ?? null;
      const rid  = resolveVar(cat, eqId);
      profile[key] = (rid && optionCache?.has(rid)) ? optionCache.get(rid) : (fallback ?? none);
    };
    applyEquip('hat',      'hat',           hatOptions?.[0]);
    applyEquip('hood',     'hood',          hoodOptions?.[0]);
    applyEquip('torso',    'torsoCosmetic', torsoPortraitOptions?.[0]);
    applyEquip('overwear', 'armCosmetic',   armPortraitOptions?.[0]);

    // Collar-locked facial hair constraint (from ScratchbonesGame collections logic)
    const portraitCfg       = window.SCRATCHBONES_CONFIG?.game?.portrait?.cosmetics || {};
    const collaredTag        = portraitCfg.collaredTag;
    const collarLockedIds    = portraitCfg.collarLockedFacialHairIds || portraitCfg.shirtbeardIds || [];
    const hasCollared        = collaredTag
      ? [profile.torsoCosmetic, profile.armCosmetic].some(c => c?.tags?.includes(collaredTag))
      : false;
    if (!hasCollared && collarLockedIds.includes(profile.facialHair?.id)) {
      profile.facialHair = optionCache?.get('none') || none;
    }

    const dyeCatalog = window.SCRATCHBONES_CONFIG?.game?.dyes?.catalog || [];
    for (const [tintKey, dyeId] of Object.entries(_state.appliedDyes || {})) {
      if (!dyeId) continue;
      const dye = dyeCatalog.find(d => d.id === dyeId);
      if (dye) {
        profile.bodyColors = {
          ...(profile.bodyColors || {}),
          [tintKey]: { ...(dye.color || {}), ...(dye.hex ? { hex: dye.hex, tintMode: 'hexShadeFill' } : {}) }
        };
      }
    }

    // Clothing pieces preview-tint from the chosen clothing dyes (Collections
    // tab), not from the character's own body color — a separate tint-slot
    // namespace (see clothingTintKeysForSlot/applyGearClothingToPlayerData in
    // game.js, the real in-game equivalent of this preview-only step) so
    // picking a dye here never touches profile.bodyColors.A/B/C.
    const clothDyeA = selectedClothDye('A');
    const clothDyeB = selectedClothDye('B');
    const clothDyeColor = (dye) => ({ ...(dye.color || {}), ...(dye.hex ? { hex: dye.hex, tintMode: 'hexShadeFill' } : {}) });
    if (clothDyeA) {
      profile.bodyColors = {
        ...(profile.bodyColors || {}),
        HAT: clothDyeColor(clothDyeA), HOOD: clothDyeColor(clothDyeA),
        TORSO: clothDyeColor(clothDyeA), CLOTH: clothDyeColor(clothDyeA),
      };
    }
    if (clothDyeB) {
      profile.bodyColors = {
        ...(profile.bodyColors || {}),
        HOOD_B: clothDyeColor(clothDyeB), CLOTH_B: clothDyeColor(clothDyeB),
      };
    }

    return profile;
  }

  function schedulePreviewRender() {
    if (_renderTimer) return;
    _renderTimer = setTimeout(() => { _renderTimer = null; _doPreviewRender(); }, 80);
  }

  async function _doPreviewRender() {
    const canvas = _el?.querySelector('#ob-portrait-canvas');
    if (!canvas) return;
    if (!_cosmetics) {
      const loaded = await ensureCosmetics();
      if (!loaded) return;
    }
    const profile = buildPreviewProfile();
    if (!profile) return;
    const renderFn = window.renderPortraitProfile || window.renderProfile;
    if (renderFn) {
      try { await renderFn(canvas, profile); } catch(e) { console.warn('[onboarding] render error', e); }
    }
  }

  // Build a portrait profile for a given appearance object (used for save-select cards)
  function buildPreviewProfileFromAppearance(appearance, equippedCosmetics, appliedDyes) {
    const prev = _state;
    _state = { appearance: appearance || {}, equippedCosmetics: equippedCosmetics || [], appliedDyes: appliedDyes || {} };
    const profile = buildPreviewProfile();
    _state = prev;
    return profile;
  }

  // ── Save Select Screen ─────────────────────────────────────────────────
  // Same controls as game.js's in-game Settings pane "Local Save Folder"
  // row (see docs/js/local-save-folder.js), surfaced here too so a
  // completely fresh browser profile can pull characters/worlds back in
  // from a previously-chosen folder before ever reaching a character to
  // play — the in-game settings pane can't help with that since it only
  // exists once you're already past this screen.
  function _localSaveFolderSectionHtml() {
    const lsf = window.LocalSaveFolder;
    if (!lsf) return '';
    const status = lsf.getStatus();
    if (!status.supported) {
      return `<div class="sl-section sl-local-save-section">
        <div class="sl-section-label">Local Save Folder</div>
        <div class="sl-local-save-row"><span class="sl-local-save-status">Not supported in this browser (Chrome/Edge only).</span></div>
      </div>`;
    }
    let statusText;
    if (status.state === 'ready') {
      const when = status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleTimeString() : 'never';
      statusText = `Saving to "${esc(status.folderName)}" — last synced ${when}.`;
    } else if (status.state === 'needs-permission') {
      statusText = `Folder "${esc(status.folderName)}" needs permission again this session.`;
    } else if (status.state === 'error') {
      statusText = 'Error: ' + esc(status.lastError || 'unknown');
    } else {
      statusText = 'No folder chosen yet.';
    }
    const buttons = [
      (status.state === 'not-configured' || status.state === 'error')
        ? `<button type="button" id="slLocalSaveChoose" class="sl-local-save-btn">Choose Folder</button>` : '',
      status.folderName ? `<button type="button" id="slLocalSaveChange" class="sl-local-save-btn">Change Folder</button>` : '',
      status.state === 'needs-permission' ? `<button type="button" id="slLocalSaveReconnect" class="sl-local-save-btn">Reconnect</button>` : '',
      status.state === 'ready' ? `<button type="button" id="slLocalSaveLoad" class="sl-local-save-btn">Load From Folder</button>` : '',
    ].join('');
    return `<div class="sl-section sl-local-save-section">
      <div class="sl-section-label">Local Save Folder</div>
      <div class="sl-local-save-row"><span class="sl-local-save-status">${statusText}</span>${buttons}</div>
    </div>`;
  }

  // ── Database Source (window.LocalDBOverrides) ──────────────────────────
  // Lets a locally-edited database (attack-values.json / loot-pools.json /
  // shop-stock.json, saved from their respective docs/tools/ editors — see
  // docs/js/local-db-overrides.js) be tested in-game before it's ever
  // committed to the repo. "Repo" is the default and only real behavior
  // change; "Local overrides" only actually swaps in a database that has a
  // saved override, so leaving it on Local with nothing saved yet behaves
  // identically to Repo.
  function _dbSourceSectionHtml() {
    const ldb = window.LocalDBOverrides;
    if (!ldb) return '';
    const mode = ldb.getSourceMode();
    const rows = ldb.listStatuses().map(s => {
      const statusTxt = s.hasOverride
        ? `override saved ${esc(new Date(s.savedAt).toLocaleString())}`
        : 'no local override';
      const clearBtn = s.hasOverride
        ? `<button type="button" class="sl-local-save-btn" data-dbsrc-clear="${esc(s.id)}">Clear</button>` : '';
      return `<div class="sl-dbsrc-row"><span class="sl-dbsrc-name">${esc(s.label)}</span><span class="sl-local-save-status">${statusTxt}</span>${clearBtn}</div>`;
    }).join('');
    return `<div class="sl-section sl-local-save-section">
      <div class="sl-section-label">Database Source <span class="sl-char-ref">— edited via docs/tools, test here before committing</span></div>
      <div class="sl-local-save-row">
        <label class="sl-dbsrc-toggle"><input type="radio" name="sl-dbsrc-mode" value="repo"${mode === 'repo' ? ' checked' : ''}> Repo (committed)</label>
        <label class="sl-dbsrc-toggle"><input type="radio" name="sl-dbsrc-mode" value="local"${mode === 'local' ? ' checked' : ''}> Local overrides</label>
      </div>
      ${rows}
    </div>`;
  }

  function buildSaveSelectHTML() {
    const meta     = _saveMeta || makeSaveMeta();
    const chars    = meta.characters || [];
    const selChar  = chars.find(c => c.id === _selCharId) || null;
    const worlds   = selChar ? worldsForCharacter(meta, selChar.id) : [];
    const selWorld = (_selWorldId && _selWorldId !== 'new') ? worlds.find(w => w.id === _selWorldId) : null;

    const charCardsHtml = chars.map(c => `
      <button class="sl-char-card${c.id === _selCharId ? ' sl-selected' : ''}" data-sl-char="${esc(c.id)}" type="button">
        <div class="sl-char-portrait-wrap">
          <canvas class="sl-portrait-canvas" data-char-id="${esc(c.id)}" width="80" height="80"></canvas>
        </div>
        <div class="sl-char-name">${esc(c.nickname || 'Farmer')}</div>
        <div class="sl-char-meta">${esc(specLabel(c.appearance?.speciesId))} · ${c.appearance?.gender === 'female' ? '♀' : '♂'}</div>
      </button>`
    ).join('');

    const newCharHtml = `<button class="sl-char-card sl-new-card" id="slNewChar" type="button">
      <div class="sl-new-plus">＋</div>
      <div class="sl-char-name">New Farmer</div>
    </button>`;

    let worldSectionHtml = '';
    if (selChar) {
      const worldCardsHtml = worlds.map(w => {
        const owner = isWorldOwner(w, selChar.id);
        const actionBtn = owner
          ? `<button class="sl-world-action sl-world-delete" data-sl-world-delete="${esc(w.id)}" type="button" title="Delete world">🗑</button>`
          : `<button class="sl-world-action sl-world-leave" data-sl-world-leave="${esc(w.id)}" type="button" title="Leave world">↩</button>`;
        return `
        <div class="sl-world-card-wrap">
          <button class="sl-world-card${w.id === _selWorldId ? ' sl-selected' : ''}" data-sl-world="${esc(w.id)}" type="button">
            <div class="sl-world-icon">🌿</div>
            <div class="sl-world-info">
              <div class="sl-world-name">${esc(w.label || 'Hobunji Hollow')}${owner ? '' : ' <span class="sl-world-role">(Farmhand)</span>'}</div>
              <div class="sl-world-meta">Day ${w.lastDay ?? 1} · ${esc(w.lastSeason ?? '—')}</div>
              <div class="sl-world-date">${relDate(w.lastPlayed)}</div>
            </div>
          </button>
          ${actionBtn}
        </div>`;
      }).join('');

      const newWorldSelected = _selWorldId === 'new';
      const newWorldHtml = `
        <div class="sl-world-card-wrap">
          <div class="sl-world-card${newWorldSelected ? ' sl-selected' : ''}" id="slNewWorld" role="button" tabindex="0">
            <div class="sl-world-icon">＋</div>
            <div class="sl-world-info">
              <div class="sl-world-name">New World</div>
              ${newWorldSelected
                ? `<input type="text" id="slNewWorldName" class="sl-world-name-input" placeholder="Hobunji Hollow" value="${esc(_newWorldName)}" maxlength="40" />`
                : `<div class="sl-world-meta">Fresh start</div>`}
            </div>
          </div>
        </div>`;

      worldSectionHtml = `
        <div class="sl-section">
          <div class="sl-section-label">Choose Your World <span class="sl-char-ref">— ${esc(selChar.nickname || 'Farmer')}</span></div>
          <div class="sl-world-grid">${worldCardsHtml}${newWorldHtml}</div>
        </div>`;

      // Other local worlds this character could join as a farmhand — lets a
      // second character (this player's own alt, pre-networking) preview
      // what joining someone else's farm will feel like once multiplayer
      // exists. Joining grants zero permissions by default; the owner grants
      // access afterward from that farm's Farm tab, same as a real invite.
      const joinable = otherLocalWorlds(meta, selChar.id);
      if (joinable.length) {
        const joinCardsHtml = joinable.map(w => {
          const owner = chars.find(c => c.id === w.ownerCharacterId);
          return `
          <div class="sl-world-card-wrap">
            <button class="sl-world-card sl-world-joinable" data-sl-world-join="${esc(w.id)}" type="button">
              <div class="sl-world-icon">🌿</div>
              <div class="sl-world-info">
                <div class="sl-world-name">${esc(w.label || 'Hobunji Hollow')}</div>
                <div class="sl-world-meta">${esc(owner?.nickname || 'Unknown')}'s farm · Day ${w.lastDay ?? 1}</div>
                <div class="sl-world-date">${relDate(w.lastPlayed)}</div>
              </div>
              <div class="sl-world-join-badge">＋ Join</div>
            </button>
          </div>`;
        }).join('');
        worldSectionHtml += `
        <div class="sl-section">
          <div class="sl-section-label">Join a Local World <span class="sl-char-ref">— joins as an ungranted farmhand until the owner grants access</span></div>
          <div class="sl-world-grid">${joinCardsHtml}</div>
        </div>`;
      }
    }

    const canPlay = selChar && (_selWorldId === 'new' || selWorld || worlds.length === 0);
    const playLabel = (!selWorld && _selWorldId !== 'new' && worlds.length === 0) ? '🌱 Start New World' : '▶ Play';

    return `<div class="ob-card sl-card">
      <div class="ob-title">🌿 Hobunji Hollow</div>
      ${_localSaveFolderSectionHtml()}
      <div class="sl-section">
        <div class="sl-section-label">Choose Your Farmer</div>
        <div class="sl-char-grid">${charCardsHtml}${newCharHtml}</div>
      </div>
      ${_dbSourceSectionHtml()}
      ${worldSectionHtml}
      <div class="sl-footer">
        ${selChar ? `<button class="sl-delete-btn" id="slDeleteChar" type="button">🗑 Delete Character</button>` : '<span></span>'}
        <button class="ob-start-btn" id="slPlay" type="button"${canPlay ? '' : ' disabled'}>${playLabel}</button>
      </div>
    </div>`;
  }

  function _renderSaveSelectPortraits() {
    if (!_el || !_saveMeta || !_cosmetics) return;
    (_saveMeta.characters || []).forEach(char => {
      const canvas = _el.querySelector(`[data-char-id="${esc(char.id)}"]`);
      if (!canvas) return;
      const profile = buildPreviewProfileFromAppearance(char.appearance, char.equippedCosmetics, char.appliedDyes);
      if (!profile) return;
      const renderFn = window.renderPortraitProfile || window.renderProfile;
      if (renderFn) { try { renderFn(canvas, profile).catch(() => {}); } catch (_) {} }
    });
  }

  function attachSaveSelectListeners() {
    if (!_el) return;

    _el.querySelectorAll('[data-sl-char]').forEach(btn => btn.addEventListener('click', () => {
      const newId = btn.dataset.slChar;
      if (_selCharId !== newId) { _selCharId = newId; _selWorldId = null; _newWorldName = ''; }
      rerenderSaveSelect();
    }));

    _el.querySelectorAll('[data-sl-world]').forEach(btn => btn.addEventListener('click', () => {
      _selWorldId = btn.dataset.slWorld;
      _newWorldName = '';
      rerenderSaveSelect();
    }));

    _el.querySelectorAll('[data-sl-world-delete]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_saveMeta) return;
      const worldId = btn.dataset.slWorldDelete;
      const world = (_saveMeta.worlds || []).find(w => w.id === worldId);
      if (!world) return;
      if (!confirm(`Delete "${world.label || 'Hobunji Hollow'}"? This cannot be undone.`)) return;
      _saveMeta.worlds = (_saveMeta.worlds || []).filter(w => w.id !== worldId);
      saveSaveMeta(_saveMeta);
      if (_selWorldId === worldId) _selWorldId = null;
      rerenderSaveSelect();
    }));

    // Farmhands can't delete a world they don't own — they leave it instead,
    // which drops their membership/farmhand grant but leaves the world (and
    // the owner's data) untouched.
    _el.querySelectorAll('[data-sl-world-leave]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_saveMeta || !_selCharId) return;
      const worldId = btn.dataset.slWorldLeave;
      const world = (_saveMeta.worlds || []).find(w => w.id === worldId);
      if (!world) return;
      if (!confirm(`Leave "${world.label || 'Hobunji Hollow'}"? You'll need a new invite to rejoin.`)) return;
      removeFarmhand(world, _selCharId);
      if (world.members) delete world.members[_selCharId];
      saveSaveMeta(_saveMeta);
      if (_selWorldId === worldId) _selWorldId = null;
      rerenderSaveSelect();
    }));

    _el.querySelectorAll('[data-sl-world-join]').forEach(btn => btn.addEventListener('click', () => {
      if (!_saveMeta || !_selCharId) return;
      const worldId = btn.dataset.slWorldJoin;
      const world = (_saveMeta.worlds || []).find(w => w.id === worldId);
      if (!world) return;
      addFarmhand(world, _selCharId, {}); // zero permissions — owner grants access later, same as a real invite
      saveSaveMeta(_saveMeta);
      _selWorldId = worldId;
      rerenderSaveSelect();
    }));

    const newWorldBtn = _el.querySelector('#slNewWorld');
    if (newWorldBtn) {
      const selectNewWorld = () => { _selWorldId = 'new'; rerenderSaveSelect(); };
      newWorldBtn.addEventListener('click', selectNewWorld);
      newWorldBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectNewWorld(); }
      });
    }

    const newWorldNameInput = _el.querySelector('#slNewWorldName');
    if (newWorldNameInput) {
      newWorldNameInput.addEventListener('input', () => { _newWorldName = newWorldNameInput.value; });
      newWorldNameInput.addEventListener('click', (e) => e.stopPropagation());
      newWorldNameInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); _playSaveSelect(); }
      });
      newWorldNameInput.focus();
    }

    const newCharBtn = _el.querySelector('#slNewChar');
    if (newCharBtn) newCharBtn.addEventListener('click', () => {
      _state     = makeDefaultState('mao-ao', 'male');
      _activeTab = 'appearance';
      _colorAIdx = 0;
      _colorBIdx = 0;
      _flowStep  = 'char-create';
      rerender();
      ensureCosmetics().then(() => schedulePreviewRender());
    });

    const deleteBtn = _el.querySelector('#slDeleteChar');
    if (deleteBtn) deleteBtn.addEventListener('click', () => {
      if (!_selCharId || !_saveMeta) return;
      if (!confirm('Delete this character and all worlds they own? This cannot be undone.')) return;
      _saveMeta.characters = (_saveMeta.characters || []).filter(c => c.id !== _selCharId);
      // Worlds this character owns are deleted outright; worlds where they were
      // only a farmhand keep going for the owner, minus this character's membership.
      _saveMeta.worlds     = (_saveMeta.worlds || []).filter(w => w.ownerCharacterId !== _selCharId);
      _saveMeta.worlds.forEach(w => {
        removeFarmhand(w, _selCharId);
        if (w.members) delete w.members[_selCharId];
      });
      saveSaveMeta(_saveMeta);
      _selCharId  = _saveMeta.characters[0]?.id ?? null;
      _selWorldId = null;
      if (!_saveMeta.characters.length) {
        _state = makeDefaultState('mao-ao', 'male');
        _activeTab = 'appearance'; _colorAIdx = 0; _colorBIdx = 0;
        _flowStep = 'char-create';
        rerender();
        ensureCosmetics().then(() => schedulePreviewRender());
      } else {
        rerenderSaveSelect();
      }
    });

    const playBtn = _el.querySelector('#slPlay');
    if (playBtn) playBtn.addEventListener('click', _playSaveSelect);

    // Local Save Folder controls — see _localSaveFolderSectionHtml above and
    // docs/js/local-save-folder.js for the actual folder/IndexedDB/File
    // System Access API work.
    const lsf = window.LocalSaveFolder;
    if (lsf) {
      _el.querySelector('#slLocalSaveChoose')?.addEventListener('click', () => lsf.chooseFolder());
      _el.querySelector('#slLocalSaveChange')?.addEventListener('click', () => lsf.changeFolder());
      _el.querySelector('#slLocalSaveReconnect')?.addEventListener('click', () => lsf.reconnect());
      _el.querySelector('#slLocalSaveLoad')?.addEventListener('click', async () => {
        if (!confirm('Load characters and worlds from your local folder? This overwrites your current browser save and reloads the page.')) return;
        const result = await lsf.loadFromFolder();
        alert(result.message);
        if (result.ok) location.reload();
      });
    }

    // Database Source controls — see _dbSourceSectionHtml above and
    // docs/js/local-db-overrides.js. Changing the mode takes effect on the
    // NEXT load (game.js/combat-config-loader.js only read it at boot), so a
    // reload is needed to actually see it in-game.
    const ldb = window.LocalDBOverrides;
    if (ldb) {
      _el.querySelectorAll('input[name="sl-dbsrc-mode"]').forEach(radio => radio.addEventListener('change', () => {
        ldb.setSourceMode(radio.value);
        rerenderSaveSelect();
      }));
      _el.querySelectorAll('[data-dbsrc-clear]').forEach(btn => btn.addEventListener('click', () => {
        ldb.clearOverride(btn.dataset.dbsrcClear);
        rerenderSaveSelect();
      }));
    }
  }

  function rerenderSaveSelect() {
    if (!_el) return;
    _el.innerHTML = buildSaveSelectHTML();
    attachSaveSelectListeners();
    if (_cosmetics) {
      _renderSaveSelectPortraits();
    } else {
      ensureCosmetics().then(cos => { if (cos) _renderSaveSelectPortraits(); });
    }
  }

  function _showSaveSelect() {
    _flowStep = 'save-select';
    rerenderSaveSelect();
  }

  function _playSaveSelect() {
    if (!_selCharId || !_saveMeta) return;
    const char = (_saveMeta.characters || []).find(c => c.id === _selCharId);
    if (!char) return;
    if (!char.playerId) char.playerId = genPlayerId();     // migrate pre-existing characters
    if (!char.stats)    char.stats    = makeDefaultStats();

    const worlds = worldsForCharacter(_saveMeta, char.id);
    let world, isNewWorld;
    if (_selWorldId === 'new' || (!_selWorldId && worlds.length === 0)) {
      world = makeDefaultWorld(char.id);
      world.label = _newWorldName.trim() || 'Hobunji Hollow';
      _newWorldName = '';
      _saveMeta.worlds.push(world);
      isNewWorld = true;
    } else {
      world = worlds.find(w => w.id === _selWorldId);
      if (!world) return;
      world.lastPlayed = Date.now();
      isNewWorld = false;
    }
    const memberState = ensureWorldMember(world, char.id);
    char.lastPlayed = Date.now();
    saveSaveMeta(_saveMeta);

    const playerData = {
      nickname:          char.nickname || 'Farmer',
      appearance:        { ...(char.appearance || {}) },
      equippedCosmetics: [...(char.equippedCosmetics || [])],
      appliedDyes:       { ...(char.appliedDyes || {}) },
      gearInventory:     { ...(char.gearInventory  || makeDefaultGear()) },
      combatLoadout:     { ...(char.combatLoadout  || {}) },
      abilityProgression: { ...(char.abilityProgression || {}) },
      equipmentSlots:    { ...(char.equipmentSlots || {}) },
      activeTool:        char.activeTool || null,
      skillLevels:       { ...(char.skillLevels    || makeDefaultSkills()) },
      stats:             { ...char.stats },
      // Character-scoped personal livestock collection (companions) — travels
      // with the character between worlds, unlike farm livestock which
      // belongs to the world. Empty/missing is backfilled with the starter
      // dabinggi-hound lazily in game.js, same as gearInventory.whistles.
      stable:            (char.stable || []).map(s => ({ ...s })),
      activeCompanionId: char.activeCompanionId ?? null,
      activeMountId:     char.activeMountId ?? null,
      activeShoulderPetId: char.activeShoulderPetId ?? null,
      playerId:          char.playerId,
      characterId:       char.id,
      worldId:           world.id,
      worldLabel:        world.label,
      worldOwnerCharacterId: world.ownerCharacterId,
      isWorldOwner:      isWorldOwner(world, char.id),
      farmhandPermissions: getFarmhandPermissions(world, char.id),
      nonGearInventory:  { ...(memberState.nonGearInventory || {}) },
      packClothing:      [...(memberState.packClothing || [])],
      npcRelationships:  { ...(memberState.npcRelationships || {}) },
      questProgress:     { ...(memberState.questProgress || {}) },
      alcoholBottleSwigs: { ...(memberState.alcoholBottleSwigs || {}) },
      npcAlcoholState: { ...(memberState.npcAlcoholState || {}) },
      alchemyKnownEffects: { ...(memberState.alchemyKnownEffects || {}) },
      alchemyActiveEffects: [...(memberState.alchemyActiveEffects || [])],
      alchemyReagentState: { ...(memberState.alchemyReagentState || {}) },
      isNewWorld,
    };
    saveProfile(playerData);
    window.__hobunjiPlayerProfile = playerData;

    _el.classList.add('ob-fade-out');
    setTimeout(() => { _el?.remove(); _el = null; }, 420);
    document.dispatchEvent(new CustomEvent('hobunjiPlayerReady', { detail: playerData }));
  }

  // ── HTML renderers ────────────────────────────────────────────────────
  function renderAppearanceBody() {
    const ap        = _state.appearance;
    const specData  = SPECIES_DATA[ap.speciesId];
    const gData     = specData?.[ap.gender];
    const colorOpts = gData?.colorOptions || [];

    const speciesBtns = Object.entries(SPECIES_DATA).map(([sid, sd]) =>
      `<button class="ob-sel-btn${ap.speciesId === sid ? ' ob-active' : ''}" data-ob-species="${esc(sid)}">${esc(sd.label)}</button>`
    ).join('');

    const availGenders = specData?.genders || ['male'];
    const genderBtns = ['male', 'female'].map(g => {
      const avail = availGenders.includes(g);
      return `<button class="ob-sel-btn${ap.gender === g ? ' ob-active' : ''}${!avail ? ' ob-disabled' : ''}"
                       data-ob-gender="${g}"${!avail ? ' disabled' : ''}>${g === 'male' ? 'Male' : 'Female'}</button>`;
    }).join('');

    let slotsHtml = '';
    for (const slotDef of (gData?.slots || [])) {
      const cur  = ap.cosmetics[slotDef.slot] || '';
      const opts = slotDef.options.map(o =>
        `<option value="${esc(o.id || '')}"${cur === (o.id || '') ? ' selected' : ''}>${esc(o.label)}</option>`
      ).join('');
      slotsHtml += `<div class="ob-row">
        <label class="ob-row-label">${esc(slotDef.label)}</label>
        <select class="ob-select" data-ob-slot="${slotDef.slot}">${opts}</select>
      </div>`;
    }

    const swatchRow = (opts, selIdx, attr) => opts.map((o, i) =>
      `<button class="ob-swatch${i === selIdx ? ' ob-active' : ''}" ${attr}="${i}"
               style="${swatchStyle(o.h, o.s, o.v, ap.speciesId)}" title="${esc(`${i + 1}. ${o.label}`)}"
               aria-label="${esc(`${i + 1}. ${o.label}`)}"><span>${i + 1}</span></button>`
    ).join('');

    return `
      <div class="ob-col ob-col-left">
        <canvas id="ob-portrait-canvas" class="ob-portrait" width="200" height="200"></canvas>
        <div class="ob-preview-hint">Live preview</div>
      </div>
      <div class="ob-col ob-col-right">
        <div class="ob-section-label">Farmer name</div>
        <input class="ob-input" id="ob-nickname" type="text" maxlength="32"
               value="${esc(_state.nickname || '')}" placeholder="Your name…"
               autocomplete="off" spellcheck="false" />

        <div class="ob-section-label" style="margin-top:12px;">Species</div>
        <div class="ob-group">${speciesBtns}</div>

        <div class="ob-section-label" style="margin-top:10px;">Gender</div>
        <div class="ob-group">${genderBtns}</div>

        <div class="ob-section-label" style="margin-top:10px;">Cosmetics</div>
        <div class="ob-cosmetics">${slotsHtml || '<div class="ob-muted">None available.</div>'}</div>

        <div class="ob-section-label" style="margin-top:10px;">Primary Color</div>
        <div class="ob-swatches">${swatchRow(colorOpts, _colorAIdx, 'data-ob-a')}</div>
        <div class="ob-section-label" style="margin-top:8px;">Secondary Color</div>
        <div class="ob-swatches">${swatchRow(colorOpts, _colorBIdx, 'data-ob-b')}</div>
      </div>`;
  }

  function renderCollectionsBody() {
    const catalog   = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
    const equipped  = _state.equippedCosmetics;
    const ap        = _state.appearance;

    let slotsHtml = '';
    for (const slot of CLOTHING_SLOTS) {
      const byCategory  = catalog.filter(i => i.category === slot.category);
      const equippedId  = catalog.find(i => i.category === slot.category && equipped.includes(i.id))?.id ?? null;
      // Deduplicate by label+material, prefer species/gender match
      const deduped = new Map();
      for (const item of byCategory) {
        const key  = `${item.label}::${item.material || ''}`;
        const prev = deduped.get(key);
        if (!prev) { deduped.set(key, item); continue; }
        const score = x => (x.species === ap.speciesId ? 2 : 0) + (x.gender === ap.gender ? 1 : 0);
        if (score(item) > score(prev) || item.id === equippedId) deduped.set(key, item);
      }
      const items = [...deduped.values()];
      const opts  = [
        `<option value="">None</option>`,
        ...items.map(i => `<option value="${esc(i.id)}"${i.id === equippedId ? ' selected' : ''}>${esc(i.label)}</option>`),
      ].join('');
      slotsHtml += `<div class="ob-row">
        <label class="ob-row-label">${esc(slot.label)}</label>
        <select class="ob-select ob-equip-sel" data-ob-equip-cat="${slot.category}"${!items.length ? ' disabled' : ''}>${opts}</select>
      </div>`;
    }

    const dyes = starterClothDyes();
    const dyeA = selectedClothDye('A');
    const dyeB = selectedClothDye('B');
    const dyeSwatchRow = (selected, attr) => dyes.map(d =>
      `<button class="ob-swatch${d.id === selected?.id ? ' ob-active' : ''}" ${attr}="${esc(d.id)}"
               style="background:${esc(d.hex)}" title="${esc(d.label)}"></button>`
    ).join('');
    return `
      <div class="ob-col ob-col-left">
        <canvas id="ob-portrait-canvas" class="ob-portrait" width="200" height="200"></canvas>
        <div class="ob-preview-hint">Live preview</div>
      </div>
      <div class="ob-col ob-col-right">
        <div class="ob-section-label">Clothing &amp; Equipment</div>
        <div class="ob-cosmetics">
          ${slotsHtml || '<div class="ob-muted">No items in shop catalog.</div>'}
        </div>
        <div class="ob-section-label" style="margin-top:10px;">Primary Dye</div>
        <div class="ob-swatches">${dyeSwatchRow(dyeA, 'data-ob-cloth-dye-a')}</div>
        <div class="ob-section-label" style="margin-top:8px;">Secondary Dye</div>
        <div class="ob-swatches">${dyeSwatchRow(dyeB, 'data-ob-cloth-dye-b')}</div>
        <div class="ob-muted" style="font-size:10px;margin-top:6px;">Rugged Poncho, Fine Poncho &amp; Fine Hood use both dyes. Every hue's Dusty shade is free to pick — brighter/darker variants unlock later.</div>
      </div>`;
  }

  function renderOverlay() {
    const hasExistingChars = _saveMeta && (_saveMeta.characters || []).length > 0;
    const body = _activeTab === 'appearance' ? renderAppearanceBody() : renderCollectionsBody();
    return `<div class="ob-card">
      <div class="ob-title">🌿 Create Your Farmer</div>
      <div class="ob-tabs">
        ${hasExistingChars ? `<button class="ob-tab ob-back-tab" id="ob-back-btn" type="button">← Back</button>` : ''}
        <button class="ob-tab${_activeTab === 'appearance'   ? ' ob-active' : ''}" data-ob-tab="appearance">✨ Appearance</button>
        <button class="ob-tab${_activeTab === 'collections'  ? ' ob-active' : ''}" data-ob-tab="collections">🧺 Collections</button>
      </div>
      <div class="ob-two-col">${body}</div>
      <div class="ob-footer">
        <span class="ob-footer-hint">Saved automatically — you can change this later.</span>
        <button class="ob-start-btn" id="ob-start-btn">🌱 Start Farming</button>
      </div>
    </div>`;
  }

  function rerender() {
    if (!_el) return;
    if (_flowStep === 'save-select') { rerenderSaveSelect(); return; }
    _el.innerHTML = renderOverlay();
    attachListeners();
    schedulePreviewRender();
  }

  // ── Event binding ─────────────────────────────────────────────────────
  function attachListeners() {
    if (!_el) return;

    const backBtn = _el.querySelector('#ob-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => {
      _flowStep = 'save-select';
      rerender();
    });

    _el.querySelectorAll('[data-ob-tab]').forEach(btn => btn.addEventListener('click', () => {
      _activeTab = btn.dataset.obTab;
      rerender();
    }));

    _el.querySelectorAll('[data-ob-species]').forEach(btn => btn.addEventListener('click', () => {
      const sid   = btn.dataset.obSpecies;
      const spec  = SPECIES_DATA[sid];
      if (!spec) return;
      const newG  = spec.genders.includes(_state.appearance.gender) ? _state.appearance.gender : spec.genders[0];
      const gData = spec[newG];
      const opts  = gData?.colorOptions || [];
      const base  = opts[0] || { h: 0, s: -0.70, v: -0.30 };
      _state.appearance.speciesId = sid;
      _state.appearance.gender    = newG;
      _state.appearance.cosmetics = {};
      _state.appearance.bodyColors = {
        A: { h: base.h, s: base.s, v: base.v },
        B: { h: base.h, s: base.s, v: base.v },
        C: deriveCFromA(base),
      };
      _colorAIdx = 0; _colorBIdx = 0;
      rerender();
    }));

    _el.querySelectorAll('[data-ob-gender]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const g = btn.dataset.obGender;
      const gData = SPECIES_DATA[_state.appearance.speciesId]?.[g];
      const opts  = gData?.colorOptions || [];
      const base  = opts[0] || { h: 0, s: -0.70, v: -0.30 };
      _state.appearance.gender    = g;
      _state.appearance.cosmetics = {};
      _state.appearance.bodyColors = {
        A: { h: base.h, s: base.s, v: base.v },
        B: { h: base.h, s: base.s, v: base.v },
        C: deriveCFromA(base),
      };
      _colorAIdx = 0; _colorBIdx = 0;
      rerender();
    }));

    _el.querySelectorAll('[data-ob-slot]').forEach(sel => sel.addEventListener('change', () => {
      const slot = sel.dataset.obSlot;
      const val  = sel.value || undefined;
      if (val) { _state.appearance.cosmetics[slot] = val; }
      else     { delete _state.appearance.cosmetics[slot]; }
      schedulePreviewRender();
    }));

    _el.querySelectorAll('[data-ob-a]').forEach(btn => btn.addEventListener('click', () => {
      const i    = parseInt(btn.dataset.obA);
      const opts = currentGenderData()?.colorOptions || [];
      if (!opts[i]) return;
      _colorAIdx = i;
      const c = opts[i];
      _state.appearance.bodyColors.A = { h: c.h, s: c.s, v: c.v };
      _state.appearance.bodyColors.C = deriveCFromA(c);
      _el.querySelectorAll('[data-ob-a]').forEach((b, bi) => b.classList.toggle('ob-active', bi === i));
      schedulePreviewRender();
    }));

    _el.querySelectorAll('[data-ob-b]').forEach(btn => btn.addEventListener('click', () => {
      const i    = parseInt(btn.dataset.obB);
      const opts = currentGenderData()?.colorOptions || [];
      if (!opts[i]) return;
      _colorBIdx = i;
      const c = opts[i];
      _state.appearance.bodyColors.B = { h: c.h, s: c.s, v: c.v };
      _el.querySelectorAll('[data-ob-b]').forEach((b, bi) => b.classList.toggle('ob-active', bi === i));
      schedulePreviewRender();
    }));

    _el.querySelectorAll('.ob-equip-sel').forEach(sel => sel.addEventListener('change', () => {
      const cat     = sel.dataset.obEquipCat;
      const val     = sel.value;
      const catalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
      _state.equippedCosmetics = _state.equippedCosmetics.filter(id => {
        const item = catalog.find(i => i.id === id);
        return item?.category !== cat;
      });
      if (val) _state.equippedCosmetics.push(val);
      schedulePreviewRender();
    }));

    _el.querySelectorAll('[data-ob-cloth-dye-a]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.obClothDyeA;
      if (!starterClothDyes().some(d => d.id === id)) return;
      _clothDyeAId = id;
      rerender();
    }));

    _el.querySelectorAll('[data-ob-cloth-dye-b]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.obClothDyeB;
      if (!starterClothDyes().some(d => d.id === id)) return;
      _clothDyeBId = id;
      rerender();
    }));

    const nicknameEl = _el.querySelector('#ob-nickname');
    if (nicknameEl) nicknameEl.addEventListener('input', () => { _state.nickname = nicknameEl.value; });

    const startBtn = _el.querySelector('#ob-start-btn');
    if (startBtn) startBtn.addEventListener('click', _complete);
  }

  // ── Completion ────────────────────────────────────────────────────────
  function _complete() {
    const playerData = {
      nickname:          (_state.nickname || '').trim() || 'Farmer',
      appearance:        { ..._state.appearance, cosmetics: { ..._state.appearance.cosmetics }, bodyColors: { ..._state.appearance.bodyColors } },
      equippedCosmetics: [..._state.equippedCosmetics],
      appliedDyes:       { ..._state.appliedDyes },
    };

    // Register new character + world in save meta
    if (_saveMeta) {
      const charId = uid('char');
      const newChar = {
        id:               charId,
        playerId:         genPlayerId(),
        nickname:         playerData.nickname,
        appearance:       playerData.appearance,
        equippedCosmetics: playerData.equippedCosmetics,
        appliedDyes:      playerData.appliedDyes,
        gearInventory:    (() => {
          const gear    = makeDefaultGear();
          const catalog = window.SCRATCHBONES_CONFIG?.game?.account?.shopCatalog || [];
          // Clothing is dyed from the Collections tab's own dye picker, not
          // the character's body-color swatches (see selectedClothDye) — the
          // two used to be conflated, so newly-equipped clothing always came
          // out tinted to match skin/fur color instead of a real choice.
          const dyeA   = selectedClothDye('A');
          const dyeB   = selectedClothDye('B');
          const colorA = dyeA ? { ...dyeA.color, hex: dyeA.hex, dyeId: dyeA.id, label: dyeA.label } : { h: 0, s: -0.70, v: -0.30, label: 'Default' };
          const colorB = dyeB ? { ...dyeB.color, hex: dyeB.hex, dyeId: dyeB.id, label: dyeB.label } : colorA;
          for (const slot of ['hat', 'hood', 'torso', 'overwear']) {
            const catItem = catalog.find(i => i.category === slot && playerData.equippedCosmetics.includes(i.id));
            if (catItem) gear.clothing[slot] = makeClothingItem(catItem, colorA, colorB);
          }
          return gear;
        })(),
        skillLevels:      makeDefaultSkills(),
        stats:            makeDefaultStats(),
        stable:           [],   // backfilled with the starter dabinggi-hound lazily in game.js
        activeCompanionId: null,
        activeMountId:     null,
        activeShoulderPetId: null,
        createdAt:        Date.now(),
        lastPlayed:       Date.now(),
      };
      const newWorld = makeDefaultWorld(charId);
      const memberState = newWorld.members[charId];
      _saveMeta.characters.push(newChar);
      _saveMeta.worlds.push(newWorld);
      saveSaveMeta(_saveMeta);
      playerData.characterId    = charId;
      playerData.playerId       = newChar.playerId;
      playerData.worldId        = newWorld.id;
      playerData.worldLabel     = newWorld.label;
      playerData.worldOwnerCharacterId = newWorld.ownerCharacterId;
      playerData.isWorldOwner   = true;
      playerData.farmhandPermissions = getFarmhandPermissions(newWorld, charId);
      playerData.gearInventory  = newChar.gearInventory;
      playerData.skillLevels    = newChar.skillLevels;
      playerData.stats          = newChar.stats;
      playerData.stable         = newChar.stable;
      playerData.activeCompanionId = newChar.activeCompanionId;
      playerData.activeMountId = newChar.activeMountId;
      playerData.activeShoulderPetId = newChar.activeShoulderPetId;
      playerData.nonGearInventory = { ...memberState.nonGearInventory };
      playerData.packClothing   = [...memberState.packClothing];
      playerData.npcRelationships = { ...memberState.npcRelationships };
      playerData.questProgress  = { ...memberState.questProgress };
      playerData.alcoholBottleSwigs = { ...(memberState.alcoholBottleSwigs || {}) };
      playerData.npcAlcoholState = { ...(memberState.npcAlcoholState || {}) };
      playerData.alchemyKnownEffects = { ...(memberState.alchemyKnownEffects || {}) };
      playerData.alchemyActiveEffects = [...(memberState.alchemyActiveEffects || [])];
      playerData.alchemyReagentState = { ...(memberState.alchemyReagentState || {}) };
      playerData.isNewWorld     = true;
    }

    saveProfile(playerData);
    window.__hobunjiPlayerProfile = playerData;

    if (_el) {
      _el.classList.add('ob-fade-out');
      setTimeout(() => { _el?.remove(); _el = null; }, 420);
    }

    document.dispatchEvent(new CustomEvent('hobunjiPlayerReady', { detail: playerData }));
  }

  // Lightweight fallback name/genotype for livestock saved before naming and
  // genetics existed. The real generation logic (random fur/plate colors,
  // sell value, breeding) lives in game.js's fuller livestock genetics
  // module — this only needs to produce *a* valid shape so old saves load.
  function defaultLivestockName(kind) {
    return kind === 'uumkaoii' ? "Uumkao'ii" : (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Livestock');
  }
  function makeDefaultGenotype(kind) {
    if (kind === 'uumkaoii') {
      return {
        fur:    { color: '#8a6d4b', copies: 2, inheritance: 'dominant' },
        plates: { color: '#4b6d5f', copies: 2, inheritance: 'dominant' },
      };
    }
    return {};
  }

  // Brings save data created before the character/world data split up to the
  // current schema: hidden player ids + stats on characters, and
  // ownerCharacterId/farmhands/members on worlds.
  function migrateSaveMeta(meta) {
    (meta.characters || []).forEach(c => {
      if (!c.playerId) c.playerId = genPlayerId();
      if (!c.stats)    c.stats    = makeDefaultStats();
      if (!c.stable)   c.stable   = []; // backfilled with the starter dabinggi-hound lazily in game.js
      if (c.activeCompanionId === undefined) c.activeCompanionId = null;
      if (c.activeMountId === undefined) c.activeMountId = null;
      if (c.activeShoulderPetId === undefined) c.activeShoulderPetId = null;
      delete c.npcFavor; // moved to world.members[charId].npcRelationships
    });
    (meta.worlds || []).forEach(w => {
      if (!w.ownerCharacterId && w.characterId) w.ownerCharacterId = w.characterId;
      delete w.characterId;
      delete w.packInventory; // dead stub field, superseded by per-member nonGearInventory
      if (!w.farmhands) w.farmhands = [];
      if (!w.members)   w.members   = {};
      if (!w.livestock) w.livestock = [];
      if (!w.breedingPairs) w.breedingPairs = [];
      if (!w.storage)   w.storage   = {};
      w.farmhands.forEach(f => { f.permissions = { ...makeDefaultFarmhandPermissions(), ...f.permissions }; });
      w.livestock.forEach(entry => {
        if (!entry.name) entry.name = defaultLivestockName(entry.kind);
        if (!entry.genotype) entry.genotype = makeDefaultGenotype(entry.kind);
      });
      // Breeding pairs used to store flat parentAId/parentBId (always
      // world-livestock ids); wrap old entries as source-tagged refs so a
      // parent can now also point into a character's personal stable.
      w.breedingPairs.forEach(pair => {
        if (pair.parentA && pair.parentB) return; // already migrated
        if (pair.parentAId) pair.parentA = { source: 'world', id: pair.parentAId };
        if (pair.parentBId) pair.parentB = { source: 'world', id: pair.parentBId };
        delete pair.parentAId;
        delete pair.parentBId;
      });
      if (w.ownerCharacterId) ensureWorldMember(w, w.ownerCharacterId);
    });
    return meta;
  }

  // ── Public API ────────────────────────────────────────────────────────
  function init(options) {
    // Cutscene Director "Preview in game": index.html's boot handoff script
    // (runs before game.js) already synthesized window.__hobunjiPlayerProfile
    // for this session, so the save-select/character-creation overlay would
    // just be unnecessary UI sitting on top of the preview — skip it.
    if (window.__hobunjiCutscenePreview) return;

    // Re-renders the save-select screen's Local Save Folder row whenever its
    // status changes (e.g. a folder picker resolving, or the periodic
    // auto-sync ticking) — subscribed once here rather than inside
    // attachSaveSelectListeners (which reruns on every rerenderSaveSelect
    // and would otherwise stack a fresh subscription each time).
    window.LocalSaveFolder?.onChange(() => { if (_flowStep === 'save-select') rerenderSaveSelect(); });
    if (!options?.resetProfile) {
      // New multi-save system: show save select if any characters exist
      const meta = loadSaveMeta();
      if (meta && (meta.characters || []).length > 0) {
        migrateSaveMeta(meta);
        _saveMeta   = meta;
        // Auto-select: most recently played character + their most recent world
        const sortedChars = [...(meta.characters || [])].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
        _selCharId  = sortedChars[0]?.id ?? null;
        _selWorldId = null;
        if (_selCharId) {
          const charWorlds = worldsForCharacter(meta, _selCharId)
            .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
          if (charWorlds.length) _selWorldId = charWorlds[0].id;
        }
        _el = document.createElement('div');
        _el.id = 'ob-overlay';
        document.body.appendChild(_el);
        _showSaveSelect();
        return;
      }

      // Legacy migration: old single-profile key exists, no save meta yet
      const saved = loadProfile();
      if (saved) {
        _saveMeta = makeSaveMeta();
        const charId = uid('char');
        _saveMeta.characters.push({
          id:               charId,
          playerId:         genPlayerId(),
          nickname:         saved.nickname || 'Farmer',
          appearance:       saved.appearance || {},
          equippedCosmetics: saved.equippedCosmetics || [],
          appliedDyes:      saved.appliedDyes || {},
          gearInventory:    makeDefaultGear(),
          skillLevels:      makeDefaultSkills(),
          stats:            makeDefaultStats(),
          createdAt:        Date.now(),
          lastPlayed:       Date.now(),
        });
        const newWorld = makeDefaultWorld(charId);
        _saveMeta.worlds.push(newWorld);
        saveSaveMeta(_saveMeta);
        _selCharId  = charId;
        _selWorldId = newWorld.id;
        _el = document.createElement('div');
        _el.id = 'ob-overlay';
        document.body.appendChild(_el);
        _showSaveSelect();
        return;
      }
    }

    // Fresh start: no saves — go straight to character creation
    _saveMeta  = makeSaveMeta();
    _flowStep  = 'char-create';
    _state     = makeDefaultState('mao-ao', 'male');
    _activeTab = 'appearance';
    _colorAIdx = 0;
    _colorBIdx = 0;

    _el = document.createElement('div');
    _el.id = 'ob-overlay';
    document.body.appendChild(_el);
    rerender();

    ensureCosmetics().then(() => schedulePreviewRender());
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); }   catch (_) {}
    try { localStorage.removeItem(SAVE_META_KEY); } catch (_) {}
    window.__hobunjiPlayerProfile = null;
    _saveMeta   = null;
    _selCharId  = null;
    _selWorldId = null;
    _flowStep   = null;
  }

  window.HobunjiOnboarding = { init, reset, loadProfile, loadSaveMeta };
})();
