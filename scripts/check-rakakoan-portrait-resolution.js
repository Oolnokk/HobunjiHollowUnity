#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const repoRoot = path.join(__dirname, '..');
const configRoot = path.join(repoRoot, 'docs', 'config');
const configBaseUrl = `${pathToFileURL(configRoot).href.replace(/\/$/, '')}/`;

global.window = {
  location: { href: 'http://localhost/docs/tools/character-studio/index.html' },
  SCRATCHBONES_CONFIG: {
    game: {
      appearanceEditor: {
        species: {},
      },
    },
  },
};

global.document = {
  createElement: () => ({ getContext: () => ({}) }),
};

global.fetch = async (input) => {
  try {
    const url = typeof input === 'string' ? input : input?.url;
    if (!url) return { ok: false, status: 400, json: async () => ({}) };
    const targetPath = fileURLToPath(url);
    const body = await fs.promises.readFile(targetPath, 'utf8');
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  } catch (err) {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

require(path.join(repoRoot, 'docs', 'js', 'portrait-utils.js'));

async function main() {
  const cosmetics = await window.loadPortraitCosmetics(configBaseUrl);
  const fighters = window.getPortraitFighters();
  // Rakakoan male is the canonical regression target: it is the documented
  // subspecies using parentSpecies=kenkari plus mandatory/exclusive upperFace.
  const fighter = fighters.find((f) => String(f.speciesId).replace(/_/g, '-') === 'rakakoan' && f.gender === 'male');
  if (!fighter) throw new Error('Could not find rakakoan male fighter');

  const mandatory = cosmetics.mandatoryCosmeticSlotsByFighter?.[fighter.id] || [];
  if (!mandatory.includes('upperFace')) {
    throw new Error(`Rakakoan mandatory slots missing upperFace for fighter ${fighter.id}`);
  }

  const exclusive = cosmetics.exclusiveCosmeticsByFighter?.[fighter.id]?.upperFace || [];
  if (!exclusive.length || exclusive.some((id) => !id.startsWith('rakakoan_'))) {
    throw new Error(`Rakakoan upperFace exclusives are missing or invalid: ${exclusive.join(', ')}`);
  }

  const none = { id: 'none', label: 'None', tintSlot: null, layers: [] };
  const exclusiveUpperFace = { id: exclusive[0], label: 'Patch', tintSlot: null, layers: [] };
  const torsoCandidate = {
    id: 'test_parent_fallback_torso',
    label: 'Test Parent Fallback Torso',
    slot: 'torso',
    tintSlot: 'TORSO',
    layers: [],
    variantLayers: {
      kenkari_male: [{ url: 'portraitsprites/torso_kenk_m.png', ax: 0, ay: 0, sx: 1, sy: 1, pos: 'back' }],
    },
  };

  const profile = window.randomPortraitProfileSeeded(
    () => 0.999,
    [fighter],
    [none], [none], [none], [none],
    [none], [none, exclusiveUpperFace], [none],
    { [fighter.id]: { A: { minH: 0, maxH: 0, stops: [{ h: 0, sMin: 0, sMax: 0, vMin: 0, vMax: 0 }, { h: 0, sMin: 0, sMax: 0, vMin: 0, vMax: 0 }] }, B: { minH: 0, maxH: 0, stops: [{ h: 0, sMin: 0, sMax: 0, vMin: 0, vMax: 0 }, { h: 0, sMin: 0, sMax: 0, vMin: 0, vMax: 0 }] }, C: { minH: 0, maxH: 0, stops: [{ h: 0, sMin: 0, sMax: 0, vMin: 0, vMax: 0 }, { h: 0, sMin: 0, sMax: 0, vMin: 0, vMax: 0 }] } } },
    { [fighter.id]: { set: new Set([torsoCandidate.id, exclusiveUpperFace.id]), disallowedCombos: [] } },
    [none], [none],
    {},
    [none, torsoCandidate], [none],
    {}, {}, undefined,
    cosmetics.mandatoryCosmeticSlotsByFighter,
    cosmetics.exclusiveCosmeticsByFighter,
  );

  if (!profile || profile.upperFace?.id === 'none') {
    throw new Error('Mandatory upperFace was not enforced for rakakoan random profile');
  }
  if (profile.torsoCosmetic?.id !== torsoCandidate.id) {
    throw new Error(`Parent-species fallback for torso variant failed; got ${profile.torsoCosmetic?.id || 'none'}`);
  }

  console.log('OK: rakakoan mandatory upperFace and parent-species fallback resolution verified.');
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exit(1);
});
