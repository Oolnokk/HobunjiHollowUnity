#!/usr/bin/env python3
from pathlib import Path
import json


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:140]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# 1) Ghoul BGM: make this one area's track explicitly play at 2x the normal
# BGM base level. music-system.js consumes this as an optional per-track
# multiplier, while every existing track defaults to 1x.
replace_once(
    'docs/js/town-mine.js',
    "  const GHOUL_BGM_TRACK = { url: 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg' };",
    "  const GHOUL_BGM_TRACK = { url: 'assets/audio/music/bgm/bgm_just_beyond_the_torchlight.ogg', volumeMultiplier: 2 }; // Ghoul-floor music deliberately plays at twice the ordinary BGM base level."
)

replace_once(
    'docs/js/music-system.js',
    "        const vol = Math.max(0, Math.min(1, Number(audioCfg.bgmVolume) || 0.48));\n        const snd = playMusicTrack(track.url, vol, fade.songFadeInMs, fade.songFadeOutMs);",
    "        const baseVol = Math.max(0, Math.min(1, Number(audioCfg.bgmVolume) || 0.48));\n        const trackVolMulRaw = Number(track.volumeMultiplier); // Optional authored per-track gain; Ghoul mine music uses 2x while existing tracks remain 1x.\n        const trackVolMul = Number.isFinite(trackVolMulRaw) ? Math.max(0, trackVolMulRaw) : 1;\n        const snd = playMusicTrack(track.url, baseVol * trackVolMul, fade.songFadeInMs, fade.songFadeOutMs);"
)

# 2) Body colors: the species swatchBase is already pale pink (#efd7d8), so
# Ghoul hue shifts should stay near zero. The old ranges mostly used negative
# saturation plus positive brightness, which washed that pink into paper-white.
# Replace both male/female A palettes with clearly pink, still-pale skin deltas.
p = Path('docs/config/species/ghoul.json')
data = json.loads(p.read_text(encoding='utf-8'))
pink_choices = [
    {
        'weight': 3,
        'range': {
            'minH': -6, 'maxH': 6,
            'stops': [
                {'h': -6, 'sMin': 0.42, 'sMax': 0.68, 'vMin': -0.10, 'vMax': 0.00},
                {'h': 6, 'sMin': 0.42, 'sMax': 0.68, 'vMin': -0.10, 'vMax': 0.00},
            ],
        },
    },
    {
        'weight': 3,
        'range': {
            'minH': -12, 'maxH': 2,
            'stops': [
                {'h': -12, 'sMin': 0.62, 'sMax': 0.88, 'vMin': -0.17, 'vMax': -0.06},
                {'h': 2, 'sMin': 0.62, 'sMax': 0.88, 'vMin': -0.17, 'vMax': -0.06},
            ],
        },
    },
    {
        'weight': 2,
        'range': {
            'minH': -20, 'maxH': -6,
            'stops': [
                {'h': -20, 'sMin': 0.34, 'sMax': 0.58, 'vMin': -0.24, 'vMax': -0.12},
                {'h': -6, 'sMin': 0.34, 'sMax': 0.58, 'vMin': -0.24, 'vMax': -0.12},
            ],
        },
    },
    {
        'weight': 2,
        'range': {
            'minH': 2, 'maxH': 12,
            'stops': [
                {'h': 2, 'sMin': 0.48, 'sMax': 0.74, 'vMin': -0.18, 'vMax': -0.07},
                {'h': 12, 'sMin': 0.48, 'sMax': 0.74, 'vMin': -0.18, 'vMax': -0.07},
            ],
        },
    },
]
for gender in ('male', 'female'):
    data[gender]['bodyColorRanges']['A']['choices'] = json.loads(json.dumps(pink_choices))
p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

# Mine Ghouls should use the species palette, not a hard-coded near-gray
# override. Give each spawn an invisible appearance seed so palette variation
# stays deterministic without changing the visible name "Ghoul".
replace_once(
    'docs/game.js',
    "                appearance: { speciesId: 'ghoul', gender, cosmetics: {}, bodyColors: { A: { h: 0, s: -0.82, v: 0.38 }, B: { h: 6, s: -0.78, v: 0.28 }, C: { h: -4, s: -0.7, v: 0.22 } } },",
    "                appearance: { speciesId: 'ghoul', gender, cosmetics: {}, randomSeed: `mine-ghoul:${mapData.mineFloor}:${spawn.col}:${spawn.row}` }, // Use Ghoul's authored pink skin palette instead of the old bright desaturated white override."
)

replace_once(
    'docs/js/npc-avatar-preview-utils.js',
    "    const profile = randomProfile(`npc-json:${npc.name || ''}:${JSON.stringify(appearance.cosmetics || {})}`, {\n      speciesId: appearance.speciesId,",
    "    const profileSeed = appearance.randomSeed || `npc-json:${npc.name || ''}:${JSON.stringify(appearance.cosmetics || {})}`; // Lets generated NPCs vary authored species palettes without changing their visible names.\n    const profile = randomProfile(profileSeed, {\n      speciesId: appearance.speciesId,"
)

# 3) Lighting: PNG-plane avatars are intentionally unlit by default. Ghoul
# enemies are special because they only make visual sense underground: convert
# their mapped sprite-plane materials to MeshLambertMaterial so cave ambient,
# directional light, and the player's mine torch affect them like the rock.
combat_path = 'docs/js/combat/combat-bandit.js'
replace_once(
    combat_path,
    "  // ── Avatar ────────────────────────────────────────────────────────\n\n  async function buildBanditAvatar(roster) {",
    "  // ── Avatar ────────────────────────────────────────────────────────\n\n  function makeGhoulAvatarMineLit(avatarRef) {\n    if (!avatarRef?.group) return avatarRef;\n    avatarRef.group.traverse(object => {\n      if (!object?.isMesh || !object.material) return;\n      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];\n      let changed = false;\n      const litMaterials = sourceMaterials.map(source => {\n        if (!source?.isMeshBasicMaterial || !source.map) return source;\n        changed = true;\n        const lit = new THREE.MeshLambertMaterial({\n          name: `${source.name || 'ghoul_sprite'}_mine_lit`,\n          map: source.map,\n          alphaMap: source.alphaMap || null,\n          color: source.color?.clone?.() || new THREE.Color(0xffffff),\n          transparent: source.transparent,\n          opacity: source.opacity,\n          alphaTest: source.alphaTest,\n          side: source.side,\n          depthTest: source.depthTest,\n          depthWrite: source.depthWrite,\n          blending: source.blending,\n          vertexColors: source.vertexColors,\n        });\n        lit.premultipliedAlpha = source.premultipliedAlpha;\n        lit.polygonOffset = source.polygonOffset;\n        lit.polygonOffsetFactor = source.polygonOffsetFactor;\n        lit.polygonOffsetUnits = source.polygonOffsetUnits;\n        lit.toneMapped = source.toneMapped;\n        lit.userData = { ...(source.userData || {}), hobunjiMineLitGhoul: true };\n        source.dispose?.();\n        return lit;\n      });\n      if (changed) object.material = Array.isArray(object.material) ? litMaterials : litMaterials[0];\n    });\n    avatarRef.group.userData = { ...(avatarRef.group.userData || {}), mineLitGhoul: true };\n    return avatarRef;\n  }\n\n  async function buildBanditAvatar(roster) {"
)

replace_once(
    combat_path,
    "    const avatarRef = await buildBanditAvatar(roster);\n    if (!avatarRef) {",
    "    const avatarRef = await buildBanditAvatar(roster);\n    if (roster?.appearance?.speciesId === 'ghoul') makeGhoulAvatarMineLit(avatarRef); // Ghoul PNGs obey the cave's actual light level instead of glowing at full unlit brightness.\n    if (!avatarRef) {"
)

# Focused regression checks: source wiring plus a small structural check of the
# Ghoul palette values. Material behavior itself is covered by the helper's
# explicit MeshBasic -> MeshLambert conversion contract.
Path('scripts/test-ghoul-mine-visuals-audio.js').write_text(r'''#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ghoul = JSON.parse(fs.readFileSync('docs/config/species/ghoul.json', 'utf8'));
const mine = fs.readFileSync('docs/js/town-mine.js', 'utf8');
const music = fs.readFileSync('docs/js/music-system.js', 'utf8');
const game = fs.readFileSync('docs/game.js', 'utf8');
const npcPreview = fs.readFileSync('docs/js/npc-avatar-preview-utils.js', 'utf8');
const bandit = fs.readFileSync('docs/js/combat/combat-bandit.js', 'utf8');

assert.match(mine, /GHOUL_BGM_TRACK = \{[^}]*volumeMultiplier: 2/, 'Ghoul BGM requests 2x base volume');
assert.match(music, /baseVol \* trackVolMul/, 'music player consumes per-track volumeMultiplier');

for (const gender of ['male', 'female']) {
  const choices = ghoul[gender].bodyColorRanges.A.choices;
  assert.equal(choices.length, 4, `${gender} keeps four authored skin-tone families`);
  for (const choice of choices) {
    for (const stop of choice.range.stops) {
      assert.ok(stop.sMin > 0, `${gender} Ghoul skin no longer desaturates toward paper white`);
      assert.ok(stop.sMax >= 0.5, `${gender} Ghoul skin retains visible pink saturation`);
      assert.ok(stop.vMax <= 0, `${gender} Ghoul skin no longer receives a brightness boost toward white`);
    }
  }
}

assert.match(game, /randomSeed: `mine-ghoul:\$\{mapData\.mineFloor\}:\$\{spawn\.col\}:\$\{spawn\.row\}`/, 'mine Ghoul spawns use deterministic palette variation');
assert.doesNotMatch(game, /speciesId: 'ghoul'[^\n]*s: -0\.82/, 'old paper-white body-color override is gone');
assert.match(npcPreview, /appearance\.randomSeed \|\| `npc-json:/, 'NPC portrait builder accepts non-visible deterministic appearance seeds');
assert.match(bandit, /function makeGhoulAvatarMineLit/, 'Ghoul-specific mine lighting helper exists');
assert.match(bandit, /new THREE\.MeshLambertMaterial\(/, 'Ghoul mapped sprite planes are converted to lit materials');
assert.match(bandit, /speciesId === 'ghoul'\) makeGhoulAvatarMineLit\(avatarRef\)/, 'only Ghoul bandit-style avatars opt into cave lighting');

console.log('Ghoul mine visual/audio tests passed');
''', encoding='utf-8')

print('Applied Ghoul music, pink palette, and mine lighting fixes.')
