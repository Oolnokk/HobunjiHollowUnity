from pathlib import Path
import json

CONFIG_TEXT = r'''{
  "schema": "hobunji_combat_vocalizations.v2",
  "assets": {
    "chargeGrunt": "assets/audio/sfx/combat/sfx_chargegrunt.m4a",
    "releaseGrunt": "assets/audio/sfx/combat/sfx_releasegrunt.m4a",
    "comboAttackGrunts": [
      "assets/audio/sfx/combat/sfx_attackgrunt_1.m4a"
    ],
    "breath": {
      "1": "assets/audio/sfx/combat/sfx_heavybreath_intensity1.m4a",
      "2": "assets/audio/sfx/combat/sfx_heavybreath_intensity2.m4a",
      "3": "assets/audio/sfx/combat/sfx_heavybreath_medium_intensity3.m4a",
      "4": "assets/audio/sfx/combat/sfx_heavybreath_intensity4.m4a",
      "5": "assets/audio/sfx/combat/sfx_heavybreath_intensity5.m4a"
    },
    "pain": {
      "1": "assets/audio/sfx/combat/sfx_pain_intensity1.m4a",
      "2": "assets/audio/sfx/combat/sfx_pain_intensity2.m4a",
      "4": "assets/audio/sfx/combat/sfx_pain_intensity4.m4a",
      "5": "assets/audio/sfx/combat/sfx_pain_intensity5.m4a",
      "6": "assets/audio/sfx/combat/sfx_pain_instensity6.m4a"
    }
  },
  "breath": {
    "intervalHighStaminaS": 4.5,
    "intervalLowStaminaS": 1.25,
    "exhaustedIntervalS": 0.85,
    "pitchRandomSemitones": 0.22,
    "volume": 0.72
  },
  "pain": {
    "dotRepeatS": 0.5,
    "pitchRandomSemitones": 1.5,
    "volume": 0.9
  },
  "grunts": {
    "pitchRandomSemitones": 1.5,
    "volume": 0.86,
    "liveStretchAbilities": [
      "chargedBreaker"
    ]
  },
  "utteranceModulation": {
    "default": {
      "male": {
        "pitchSemitones": 0,
        "tempo": 1,
        "gain": 1
      },
      "female": {
        "pitchSemitones": 0,
        "tempo": 1,
        "gain": 1
      }
    },
    "species": {
      "mao-ao": {
        "female": { "pitchSemitones": 6, "tempo": 1, "gain": 1 },
        "male": { "pitchSemitones": 1, "tempo": 1, "gain": 1 }
      },
      "ghoul": {
        "male": { "pitchSemitones": 1, "tempo": 1, "gain": 1 },
        "female": { "pitchSemitones": 6, "tempo": 1, "gain": 1 }
      },
      "mao-ao-skeleton": {
        "female": { "pitchSemitones": 0, "tempo": 1, "gain": 0 },
        "male": { "pitchSemitones": 0, "tempo": 1, "gain": 0 }
      },
      "harlyao-skeleton": {
        "male": { "pitchSemitones": 0, "tempo": 1, "gain": 0 },
        "female": { "pitchSemitones": 0, "tempo": 1, "gain": 0 }
      },
      "harlyao": {
        "female": { "pitchSemitones": 3, "tempo": 1, "gain": 1 },
        "male": { "pitchSemitones": -5, "tempo": 1, "gain": 1 }
      },
      "porakaneki": {
        "male": { "pitchSemitones": 9, "tempo": 1, "gain": 1 },
        "female": { "pitchSemitones": 11, "tempo": 1, "gain": 1 }
      },
      "tletingan": {
        "male": { "pitchSemitones": 3, "tempo": 1, "gain": 1 },
        "female": { "pitchSemitones": 7.5, "tempo": 1, "gain": 1 }
      },
      "nuhongan": {
        "female": { "pitchSemitones": 14, "tempo": 1, "gain": 1 },
        "male": { "pitchSemitones": 7, "tempo": 1, "gain": 1 }
      },
      "kenkari": {
        "male": { "pitchSemitones": 4, "tempo": 1, "gain": 1 },
        "female": { "pitchSemitones": 8.5, "tempo": 1, "gain": 1 }
      },
      "rakakoan": {
        "female": { "pitchSemitones": 8.5, "tempo": 1, "gain": 1 },
        "male": { "pitchSemitones": 4, "tempo": 1, "gain": 1 }
      },
      "mashtzarr": {
        "male": { "pitchSemitones": -6, "tempo": 1, "gain": 1 },
        "female": { "pitchSemitones": 5, "tempo": 1, "gain": 1 }
      },
      "mammakhbuur": {
        "female": { "pitchSemitones": 4, "tempo": 1, "gain": 1 },
        "male": { "pitchSemitones": -9, "tempo": 1, "gain": 1 }
      },
      "engh-sho": {
        "female": { "pitchSemitones": 4.5, "tempo": 1, "gain": 1 },
        "male": { "pitchSemitones": 0.5, "tempo": 1, "gain": 1 }
      }
    }
  },
  "chargePlayback": {
    "earlyReleaseNormalSpeedMul": 2,
    "fullChargeDurationByAbility": {
      "chargedBreaker": 4
    }
  }
}'''

config = json.loads(CONFIG_TEXT)
config_path = Path('docs/config/combat/combat-vocalizations.json')
config_path.write_text(json.dumps(config, indent=2) + '\n')

# Keep the runtime fallback in lockstep with the authored JSON so a failed fetch
# does not silently revert cadence, random pitch, or species/gender voice tuning.
runtime_path = Path('docs/js/combat/combat-vocalizations.js')
runtime = runtime_path.read_text()
start_token = '  const DEFAULT_CONFIG = Object.freeze('
end_token = '\n\n  let config = clone(DEFAULT_CONFIG);'
start = runtime.index(start_token)
end = runtime.index(end_token, start)
js_config = json.dumps(config, indent=4).replace('\n', '\n  ')
runtime = runtime[:start] + f'  const DEFAULT_CONFIG = Object.freeze({js_config});' + runtime[end:]
runtime_path.write_text(runtime)

# The animal path remains capped at +/-12 semitones. Generic/combat playback gets
# a wider +/-24 range because authored combat profiles intentionally reach +14.
playback_path = Path('docs/js/animal-voice-independent-playback.js')
playback = playback_path.read_text()

def replace_once(text, old, new):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'Expected exactly one match ({count} found): {old[:100]!r}')
    return text.replace(old, new, 1)

playback = replace_once(playback,
    '  const GENERIC_MAX_TEMPO = 4; // Shared pitch-preserving renderer may serve faster non-animal one-shots without changing animal authoring limits.\n  const MAX_SHIFT_SEMITONES = 12;',
    '  const GENERIC_MAX_TEMPO = 4; // Shared pitch-preserving renderer may serve faster non-animal one-shots without changing animal authoring limits.\n  const MAX_SHIFT_SEMITONES = 12;\n  const GENERIC_MAX_SHIFT_SEMITONES = 24; // Combat profiles can exceed animal authoring pitch limits without changing animal-call behavior.'
)
playback = replace_once(playback,
    '  function clampPitch(value) { return clamp(finite(value, 0), -MAX_SHIFT_SEMITONES, MAX_SHIFT_SEMITONES); }',
    '  function clampPitchFor(value, maxShiftSemitones = MAX_SHIFT_SEMITONES) { return clamp(finite(value, 0), -maxShiftSemitones, maxShiftSemitones); }\n  function clampPitch(value) { return clampPitchFor(value, MAX_SHIFT_SEMITONES); }'
)
playback = replace_once(playback,
    '  function processConstantAxes(buffer, tempo, pitchSemitones, maxTempo = MAX_TEMPO) {\n    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());\n    const pitchRatio = Math.pow(2, clampPitch(pitchSemitones) / 12);',
    '  function processConstantAxes(buffer, tempo, pitchSemitones, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES) {\n    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());\n    const pitchRatio = Math.pow(2, clampPitchFor(pitchSemitones, maxPitchSemitones) / 12);'
)
playback = replace_once(playback,
    '  function renderCacheKey(url, tempo, pitchSemitones, maxTempo = MAX_TEMPO) {\n    return `${absoluteUrl(url)}|${clampTempoFor(tempo, maxTempo).toFixed(4)}|${clampPitch(pitchSemitones).toFixed(3)}`;\n  }',
    '  function renderCacheKey(url, tempo, pitchSemitones, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES) {\n    return `${absoluteUrl(url)}|${clampTempoFor(tempo, maxTempo).toFixed(4)}|${clampPitchFor(pitchSemitones, maxPitchSemitones).toFixed(3)}`;\n  }'
)
playback = replace_once(playback,
    '  function renderBufferFor(url, decoded, context, tempo, pitchSemitones, maxTempo = MAX_TEMPO) {\n    const key = renderCacheKey(url, tempo, pitchSemitones, maxTempo);',
    '  function renderBufferFor(url, decoded, context, tempo, pitchSemitones, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES) {\n    const key = renderCacheKey(url, tempo, pitchSemitones, maxTempo, maxPitchSemitones);'
)
playback = replace_once(playback,
    '      const channels = processConstantAxes(decoded, tempo, pitchSemitones, maxTempo);',
    '      const channels = processConstantAxes(decoded, tempo, pitchSemitones, maxTempo, maxPitchSemitones);'
)
playback = replace_once(playback,
    '    const pitchSemitones = clampPitch(opts.pitchSemitones ?? 0);',
    '    const pitchSemitones = clampPitchFor(opts.pitchSemitones ?? 0, GENERIC_MAX_SHIFT_SEMITONES);'
)
playback = replace_once(playback,
    '      const channels = processConstantAxes(decoded, tempo, pitchSemitones, GENERIC_MAX_TEMPO);',
    '      const channels = processConstantAxes(decoded, tempo, pitchSemitones, GENERIC_MAX_TEMPO, GENERIC_MAX_SHIFT_SEMITONES);'
)
playback = replace_once(playback,
    '    const pitchRatio = Math.pow(2, clampPitch(opts.pitchSemitones) / 12); // Used by native BufferSource resampling so audible transposition avoids the custom cubic resampler.',
    '    const pitchRatio = Math.pow(2, clampPitchFor(opts.pitchSemitones, opts.pitchMaxSemitones ?? MAX_SHIFT_SEMITONES) / 12); // Used by native BufferSource resampling so audible transposition avoids the custom cubic resampler.'
)
playback = replace_once(playback,
    '    const pitch = clampPitch(opts.pitchSemitones);',
    '    const pitch = clampPitchFor(opts.pitchSemitones, opts.pitchMaxSemitones ?? MAX_SHIFT_SEMITONES);'
)
playback = replace_once(playback,
    '  function playWithTempoLimit(url, opts = {}, maxTempo = MAX_TEMPO) {\n    if (!url || window.AudioSystem?.gameAudioConfig?.()?.enabled === false) return null;\n    const resolved = absoluteUrl(url);\n    const tempo = clampTempoFor(opts.tempo ?? 1, maxTempo);\n    const pitchSemitones = clampPitch(opts.pitchSemitones ?? 0);',
    '  function playWithTempoLimit(url, opts = {}, maxTempo = MAX_TEMPO, maxPitchSemitones = MAX_SHIFT_SEMITONES) {\n    if (!url || window.AudioSystem?.gameAudioConfig?.()?.enabled === false) return null;\n    const resolved = absoluteUrl(url);\n    const tempo = clampTempoFor(opts.tempo ?? 1, maxTempo);\n    const pitchSemitones = clampPitchFor(opts.pitchSemitones ?? 0, maxPitchSemitones);'
)
playback = playback.replace(
    '{ ...opts, tempo, tempoMax: maxTempo, pitchSemitones, onFinished: completed }',
    '{ ...opts, tempo, tempoMax: maxTempo, pitchSemitones, pitchMaxSemitones: maxPitchSemitones, onFinished: completed }'
)
if playback.count('pitchMaxSemitones: maxPitchSemitones') != 2:
    raise RuntimeError('Expected both native fallback call sites to receive generic pitch ceiling')
playback = replace_once(playback,
    '.then(decoded => renderBufferFor(resolved, decoded, context, tempo, pitchSemitones, maxTempo))',
    '.then(decoded => renderBufferFor(resolved, decoded, context, tempo, pitchSemitones, maxTempo, maxPitchSemitones))'
)
playback = replace_once(playback,
    '        active = scheduleProcessedBuffer(context, rendered, { ...opts, tempo, pitchSemitones }, completed);',
    '        active = scheduleProcessedBuffer(context, rendered, { ...opts, tempo, pitchSemitones, pitchMaxSemitones: maxPitchSemitones }, completed);'
)
playback = replace_once(playback,
    '  function play(url, opts = {}) {\n    return playWithTempoLimit(url, opts, MAX_TEMPO);\n  }\n\n  function playIndependent(url, opts = {}) {\n    return playWithTempoLimit(url, opts, GENERIC_MAX_TEMPO);\n  }',
    '  function play(url, opts = {}) {\n    return playWithTempoLimit(url, opts, MAX_TEMPO, MAX_SHIFT_SEMITONES);\n  }\n\n  function playIndependent(url, opts = {}) {\n    return playWithTempoLimit(url, opts, GENERIC_MAX_TEMPO, GENERIC_MAX_SHIFT_SEMITONES);\n  }'
)
playback_path.write_text(playback)

editor_path = Path('docs/tools/combat-vocalization-editor/index.html')
editor = editor_path.read_text()
editor = editor.replace(
    'Direct Health damage vocalizes every hit. Net DoT Health loss is throttled to one vocalization per second. Intensity is chosen from a three-slot weighted window around remaining Health.',
    'Direct Health damage vocalizes every hit. Net DoT Health loss is throttled to the configured repeat interval. Intensity is chosen from a three-slot weighted window around remaining Health.'
)
editor_path.write_text(editor)

test_path = Path('scripts/test-combat-vocalizations.js')
test = test_path.read_text()
test = test.replace(
    "assert.match(animalPlaybackSource, /renderDecodedIndependentBuffer/, 'combat should reuse the animal-call independent tempo/pitch renderer');",
    "assert.match(animalPlaybackSource, /renderDecodedIndependentBuffer/, 'combat should reuse the animal-call independent tempo/pitch renderer');\nassert.match(animalPlaybackSource, /GENERIC_MAX_SHIFT_SEMITONES = 24/, 'combat may use +14 semitone profiles without raising the animal-call +/-12 ceiling');\nassert.equal(context.window.CombatVocalizations.getConfig().utteranceModulation.species.nuhongan.female.pitchSemitones, 14, 'authored Nuhongan female combat voice keeps its +14 semitone profile');"
)
test = test.replace(
    '// DoT vocalizations throttle to one per second.\nnow = 30000;\nconst beforeDot = played.length;\nemit(listeners, \'hobunji-resource-change\', { entity: player, delta: -1, immediate: false, reason: \'resource-tick\' });\nnow = 30500;\nemit(listeners, \'hobunji-resource-change\', { entity: player, delta: -1, immediate: false, reason: \'resource-tick\' });\nassert.equal(played.length, beforeDot + 1, \'second DoT tick inside one second must be silent\');\nnow = 31001;\nemit(listeners, \'hobunji-resource-change\', { entity: player, delta: -1, immediate: false, reason: \'resource-tick\' });\nassert.equal(played.length, beforeDot + 2, \'DoT pain should repeat after one second\');',
    '// DoT vocalizations throttle to the authored half-second cadence.\nnow = 30000;\nconst beforeDot = played.length;\nemit(listeners, \'hobunji-resource-change\', { entity: player, delta: -1, immediate: false, reason: \'resource-tick\' });\nnow = 30499;\nemit(listeners, \'hobunji-resource-change\', { entity: player, delta: -1, immediate: false, reason: \'resource-tick\' });\nassert.equal(played.length, beforeDot + 1, \'second DoT tick inside half a second must be silent\');\nnow = 30501;\nemit(listeners, \'hobunji-resource-change\', { entity: player, delta: -1, immediate: false, reason: \'resource-tick\' });\nassert.equal(played.length, beforeDot + 2, \'DoT pain should repeat after half a second\');'
)
test_path.write_text(test)

print('Applied combat vocal config and generic pitch-range support')
