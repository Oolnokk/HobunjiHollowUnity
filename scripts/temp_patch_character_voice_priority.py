from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)

# -----------------------------------------------------------------------------
# Shared per-character voice owner. Dialogue and combat both use this so one
# character never emits two voice clips at once, and higher-priority reactions
# can preempt lower-priority sounds with a short click-safe fade.
# -----------------------------------------------------------------------------
voice_owner = r'''// Shared one-voice-per-character arbitration for dialogue and combat vocals.
(() => {
  'use strict';

  const VERSION = 1;
  const DEFAULT_FADE_OUT_S = 0.008; // Abrupt enough to feel immediate while avoiding hard-stop clicks/pops.
  const PRIORITY = Object.freeze({
    breath: 1,
    dialogue: 1.5,
    pain: 2,
    active: 3,
  });
  const objectSlots = new WeakMap(); // Anonymous runtime entities retain identity without preventing garbage collection.
  const stableSlots = new Map(); // NPC/player IDs let dialogue records and combat entities resolve to the same voice slot.
  const activeClaims = new Set(); // Small debug/reset surface; claims remove themselves on release/preemption.
  let serial = 0;

  function keyFor(subject) {
    if (subject == null) return null;
    if (typeof subject !== 'object' && typeof subject !== 'function') return `actor:${String(subject)}`;
    if (subject === window.Combat?.deps?.player) return 'actor:player';
    const stableId = subject.voiceOwnerKey
      || subject.npcId
      || subject.id
      || subject.rec?.id
      || subject.rosterRecord?.id
      || subject.rosterRecord?.name
      || subject.name;
    return stableId ? `actor:${String(stableId)}` : subject;
  }

  function getSlot(key) {
    if (key == null) return null;
    return typeof key === 'object' || typeof key === 'function'
      ? objectSlots.get(key) || null
      : stableSlots.get(key) || null;
  }

  function setSlot(key, value) {
    if (key == null) return;
    const objectKey = typeof key === 'object' || typeof key === 'function';
    const store = objectKey ? objectSlots : stableSlots;
    if (value == null) store.delete(key);
    else store.set(key, value);
  }

  function release(claim) {
    if (!claim || claim.released) return false;
    claim.released = true;
    activeClaims.delete(claim);
    if (getSlot(claim.key) === claim) setSlot(claim.key, null);
    return true;
  }

  function request(subject, options = {}) {
    const key = keyFor(subject);
    if (key == null) return null;
    const priority = Number.isFinite(Number(options.priority)) ? Number(options.priority) : 0;
    const current = getSlot(key);
    if (current && !current.released && current.priority > priority) return null;

    const fadeOutS = Math.max(0, Number(options.fadeOutS ?? DEFAULT_FADE_OUT_S) || 0);
    const claim = {
      id: ++serial,
      key,
      subject,
      kind: String(options.kind || 'voice'),
      priority,
      fadeOutS,
      handoffDelayS: current && !current.released ? fadeOutS : 0,
      stop: null,
      released: false,
      preempted: false,
    };
    setSlot(key, claim);
    activeClaims.add(claim);

    if (current && !current.released) {
      current.preempted = true;
      activeClaims.delete(current);
      try { current.stop?.(fadeOutS, { reason: 'preempted', by: claim }); } catch (_) {}
    }
    return claim;
  }

  function bindStop(claim, stop) {
    if (!claim || typeof stop !== 'function') return false;
    claim.stop = stop;
    if (claim.released || claim.preempted || getSlot(claim.key) !== claim) {
      try { stop(claim.fadeOutS, { reason: 'late-bind-preempted' }); } catch (_) {}
      return false;
    }
    return true;
  }

  function stop(subjectOrClaim, fadeOutS = DEFAULT_FADE_OUT_S) {
    const claim = subjectOrClaim?.key && Object.prototype.hasOwnProperty.call(subjectOrClaim, 'priority')
      ? subjectOrClaim
      : getSlot(keyFor(subjectOrClaim));
    if (!claim || claim.released) return false;
    claim.preempted = true;
    activeClaims.delete(claim);
    if (getSlot(claim.key) === claim) setSlot(claim.key, null);
    try { claim.stop?.(Math.max(0, Number(fadeOutS) || 0), { reason: 'stopped' }); } catch (_) {}
    return true;
  }

  function current(subject) {
    const claim = getSlot(keyFor(subject));
    if (!claim || claim.released) return null;
    return {
      id: claim.id,
      kind: claim.kind,
      priority: claim.priority,
      key: typeof claim.key === 'string' ? claim.key : '(runtime-object)',
    };
  }

  function debugSnapshot() {
    return [...activeClaims].filter(claim => !claim.released).map(claim => ({
      id: claim.id,
      kind: claim.kind,
      priority: claim.priority,
      key: typeof claim.key === 'string' ? claim.key : '(runtime-object)',
      preempted: claim.preempted,
    }));
  }

  window.CharacterVoiceOwner = Object.freeze({
    version: VERSION,
    priorities: PRIORITY,
    defaultFadeOutS: DEFAULT_FADE_OUT_S,
    keyFor,
    request,
    bindStop,
    release,
    stop,
    current,
    debugSnapshot,
  });
})();
'''
write('docs/js/character-voice-owner.js', voice_owner)

# -----------------------------------------------------------------------------
# Load shared owner before dialogue. Combat vocalizations are dynamically loaded
# later by combat-config-loader and can therefore reuse the same service.
# -----------------------------------------------------------------------------
index = read('docs/index.html')
index = replace_once(
    index,
    '  <script src="js/dialogue-rich-text.js?v=20260929colors1"></script>\n  <script src="js/dialogue-content.js?v=20261013h8377e46"></script>',
    '  <script src="js/dialogue-rich-text.js?v=20260929colors1"></script>\n  <script src="js/character-voice-owner.js?v=20261013voiceowner1"></script>\n  <script src="js/dialogue-content.js?v=20261013h8377e46"></script>',
    'index voice owner load',
)
write('docs/index.html', index)

# -----------------------------------------------------------------------------
# Shared independent playback: allow owner handoffs to fade the already-routed
# dry+wet voice instead of hard-stopping the source and popping.
# -----------------------------------------------------------------------------
animal = read('docs/js/animal-voice-independent-playback.js')
animal = replace_once(
    animal,
    '    let stopped = false;\n    let finishTimer = null;',
    '    let stopped = false;\n    let stopping = false; // A priority handoff may ramp this voice out for a few milliseconds before final cleanup.\n    let finishTimer = null;',
    'processed buffer stopping flag',
)
animal = replace_once(
    animal,
    '''    function stop() {
      if (stopped) return;
      try { source.stop(); } catch (_) {}
      cleanup();
    }''',
    '''    function stop(fadeOutS = 0) {
      if (stopped || stopping) return;
      const fade = clamp(finite(fadeOutS, 0), 0, 0.08);
      if (!(fade > 0) || !master?.gain) {
        try { source.stop(); } catch (_) {}
        cleanup();
        return;
      }
      stopping = true;
      const at = context.currentTime;
      try {
        if (typeof master.gain.cancelAndHoldAtTime === 'function') master.gain.cancelAndHoldAtTime(at);
        else {
          master.gain.cancelScheduledValues?.(at);
          master.gain.setValueAtTime(Math.max(0.0001, Number(master.gain.value) || 0.0001), at);
        }
        master.gain.linearRampToValueAtTime(0.0001, at + fade);
        source.stop(at + fade + 0.001);
      } catch (_) {
        try { source.stop(); } catch (_) {}
        cleanup();
        return;
      }
      clearTimeout(finishTimer);
      finishTimer = setTimeout(cleanup, Math.max(1, Math.ceil((fade + 0.004) * 1000)));
    }''',
    'processed buffer fade stop',
)
animal = replace_once(
    animal,
    '      stopped = true;\n      clearTimeout(finishTimer);',
    '      stopped = true;\n      stopping = false;\n      clearTimeout(finishTimer);',
    'processed cleanup stopping reset',
)
animal = replace_once(
    animal,
    '    let finished = false;\n    let started = false;',
    '    let finished = false;\n    let started = false;\n    let fadeTimer = null; // Native fallback uses a tiny volume ramp when a higher-priority voice preempts it.',
    'native fade timer',
)
animal = replace_once(
    animal,
    '''    const cleanup = () => {
      if (finished) return;
      finished = true;
      opts.onFinished?.();
    };''',
    '''    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (fadeTimer) clearInterval(fadeTimer);
      fadeTimer = null;
      opts.onFinished?.();
    };''',
    'native cleanup timer',
)
animal = replace_once(
    animal,
    '''      stop() {
        try { audio.pause(); audio.currentTime = 0; } catch (_) {}
        cleanup();
      },''',
    '''      stop(fadeOutS = 0) {
        const fade = clamp(finite(fadeOutS, 0), 0, 0.08);
        if (!(fade > 0) || finished) {
          try { audio.pause(); audio.currentTime = 0; } catch (_) {}
          cleanup();
          return;
        }
        const startedAt = Date.now();
        const startVolume = Math.max(0, Number(audio.volume) || 0);
        if (fadeTimer) clearInterval(fadeTimer);
        fadeTimer = setInterval(() => {
          const t = Math.min(1, (Date.now() - startedAt) / Math.max(1, fade * 1000));
          try { audio.volume = startVolume * (1 - t); } catch (_) {}
          if (t < 1) return;
          clearInterval(fadeTimer);
          fadeTimer = null;
          try { audio.pause(); audio.currentTime = 0; } catch (_) {}
          cleanup();
        }, 2);
      },''',
    'native fallback fade stop',
)
animal = replace_once(
    animal,
    '''      stop() {
        if (stopped) return;
        stopped = true;
        active?.stop?.();
        activeHandles.delete(handle);
      },''',
    '''      stop(fadeOutS = 0) {
        if (stopped) return;
        stopped = true;
        active?.stop?.(fadeOutS);
        activeHandles.delete(handle);
      },''',
    'generic handle fade forwarding',
)
write('docs/js/animal-voice-independent-playback.js', animal)

# -----------------------------------------------------------------------------
# Dialogue: share the global character voice slot. Dialogue is above breathing
# but below pain/active grunts, and keeps its existing 4ms/8ms anti-pop envelope.
# -----------------------------------------------------------------------------
dlg = read('docs/js/dialogue-content.js')
dlg = replace_once(
    dlg,
    "  function _npcSpeechOwnerKey(rec = _dlgNpcRec || deps?.getDialogueWalker?.()?.rec) {\n    return String(rec?.id || rec?.name || 'npc-dialogue');\n  }",
    "  function _npcSpeechOwnerKey(rec = _dlgNpcRec || deps?.getDialogueWalker?.()?.rec) {\n    return window.CharacterVoiceOwner?.keyFor?.(rec) || String(rec?.id || rec?.name || 'npc-dialogue');\n  }",
    'dialogue owner key',
)
dlg = replace_once(
    dlg,
    '    try { handle.wet?.send?.disconnect?.(); } catch (_) {}\n    if (_npcSpeechBySpeaker.get(handle.ownerKey) === handle) _npcSpeechBySpeaker.delete(handle.ownerKey);',
    '    try { handle.wet?.send?.disconnect?.(); } catch (_) {}\n    window.CharacterVoiceOwner?.release?.(handle.voiceClaim);\n    if (_npcSpeechBySpeaker.get(handle.ownerKey) === handle) _npcSpeechBySpeaker.delete(handle.ownerKey);',
    'dialogue release shared claim',
)
dlg = replace_once(
    dlg,
    '  function _fadeNpcSpeechHandle(handle) {\n    if (!handle || handle.finished || handle.stopping) return;\n    handle.stopping = true;\n    clearTimeout(handle.startTimer);\n    const ctx = handle.ctx;\n    const param = handle.gain?.gain;\n    if (!ctx || !param) { _finishNpcSpeechHandle(handle); return; }\n    const now = ctx.currentTime;',
    '''  function _fadeNpcSpeechHandle(handle, fadeOutS = NPC_SPEECH_FADE_OUT_S) {
    if (!handle || handle.finished || handle.stopping) return;
    handle.stopping = true;
    clearTimeout(handle.startTimer);
    const fade = Math.max(0, Number(fadeOutS) || 0);
    const ctx = handle.ctx;
    const param = handle.gain?.gain;
    if (!ctx || !param) {
      if (handle.audio && fade > 0) {
        const startVolume = Math.max(0, Number(handle.audio.volume) || Number(handle.volume) || 0);
        const startedAt = Date.now();
        handle.nativeFadeTimer = setInterval(() => {
          const t = Math.min(1, (Date.now() - startedAt) / Math.max(1, fade * 1000));
          try { handle.audio.volume = startVolume * (1 - t); } catch (_) {}
          if (t < 1) return;
          clearInterval(handle.nativeFadeTimer);
          handle.nativeFadeTimer = null;
          _finishNpcSpeechHandle(handle);
        }, 2);
        return;
      }
      _finishNpcSpeechHandle(handle);
      return;
    }
    const now = ctx.currentTime;''',
    'dialogue parameterized fade',
)
dlg = replace_once(
    dlg,
    '      param.linearRampToValueAtTime(0.0001, now + NPC_SPEECH_FADE_OUT_S);\n    } catch (_) {}\n    handle.stopTimer = setTimeout(() => _finishNpcSpeechHandle(handle), Math.ceil(NPC_SPEECH_FADE_OUT_S * 1000) + 2);',
    '      param.linearRampToValueAtTime(0.0001, now + fade);\n    } catch (_) {}\n    handle.stopTimer = setTimeout(() => _finishNpcSpeechHandle(handle), Math.ceil(fade * 1000) + 2);',
    'dialogue fade duration usage',
)
dlg = replace_once(
    dlg,
    '    clearTimeout(handle.stopTimer);\n    try { handle.audio?.pause?.(); } catch (_) {}',
    '    clearTimeout(handle.stopTimer);\n    if (handle.nativeFadeTimer) clearInterval(handle.nativeFadeTimer);\n    handle.nativeFadeTimer = null;\n    try { handle.audio?.pause?.(); } catch (_) {}',
    'dialogue native fade cleanup',
)
dlg = replace_once(
    dlg,
    '''    const ownerKey = _npcSpeechOwnerKey(rec);
    const previous = _npcSpeechBySpeaker.get(ownerKey) || null;
    if (previous) _fadeNpcSpeechHandle(previous);
    const ctx = _npcSpeechAudioContext();
    const replaceDelayMs = previous ? Math.ceil(NPC_SPEECH_FADE_OUT_S * 1000) : 0;
''',
    '''    const ownerKey = _npcSpeechOwnerKey(rec);
    const voicePriority = window.CharacterVoiceOwner?.priorities?.dialogue ?? 1.5;
    const voiceClaim = window.CharacterVoiceOwner?.request?.(rec, { kind: 'dialogue', priority: voicePriority, fadeOutS: NPC_SPEECH_FADE_OUT_S }) || null;
    if (window.CharacterVoiceOwner && !voiceClaim) return; // A pain/grunt already owns this NPC's mouth; dialogue waits for a later syllable.
    const previous = _npcSpeechBySpeaker.get(ownerKey) || null;
    if (!window.CharacterVoiceOwner && previous) _fadeNpcSpeechHandle(previous);
    const ctx = _npcSpeechAudioContext();
    const replaceDelayMs = Math.ceil(Math.max(previous ? NPC_SPEECH_FADE_OUT_S : 0, Number(voiceClaim?.handoffDelayS) || 0) * 1000);
''',
    'dialogue shared request',
)
# Add voiceClaim/nativeFadeTimer to each of the three handle shapes.
dlg = dlg.replace(
    "const handle = { ownerKey, audio: snd, ctx: null, gain: null, volume, startTimer: 0, stopTimer: 0, finished: false, stopping: false };",
    "const handle = { ownerKey, voiceClaim, audio: snd, ctx: null, gain: null, volume, startTimer: 0, stopTimer: 0, nativeFadeTimer: null, finished: false, stopping: false };",
)
dlg = dlg.replace(
    "const handle = { ownerKey, audio: snd, source, ctx, gain, wet, volume, startTimer: 0, stopTimer: 0, finished: false, stopping: false };",
    "const handle = { ownerKey, voiceClaim, audio: snd, source, ctx, gain, wet, volume, startTimer: 0, stopTimer: 0, nativeFadeTimer: null, finished: false, stopping: false };",
)
dlg = dlg.replace(
    "const handle = { ownerKey, osc, ctx, gain, wet, volume, startTimer: 0, stopTimer: 0, finished: false, stopping: false };",
    "const handle = { ownerKey, voiceClaim, osc, ctx, gain, wet, volume, startTimer: 0, stopTimer: 0, nativeFadeTimer: null, finished: false, stopping: false };",
)
if dlg.count('voiceClaim,') < 3:
    raise RuntimeError('dialogue handle voice claims were not inserted')
# Bind shared stop callback immediately after each handle is installed in the local map.
dlg = dlg.replace(
    '        _npcSpeechBySpeaker.set(ownerKey, handle);\n        snd.addEventListener?.',
    '        _npcSpeechBySpeaker.set(ownerKey, handle);\n        window.CharacterVoiceOwner?.bindStop?.(voiceClaim, fadeS => _fadeNpcSpeechHandle(handle, fadeS));\n        snd.addEventListener?.',
    1,
)
dlg = dlg.replace(
    '      _npcSpeechBySpeaker.set(ownerKey, handle);\n      snd.addEventListener?.',
    '      _npcSpeechBySpeaker.set(ownerKey, handle);\n      window.CharacterVoiceOwner?.bindStop?.(voiceClaim, fadeS => _fadeNpcSpeechHandle(handle, fadeS));\n      snd.addEventListener?.',
    1,
)
dlg = dlg.replace(
    '    _npcSpeechBySpeaker.set(ownerKey, handle);\n    osc.onended =',
    '    _npcSpeechBySpeaker.set(ownerKey, handle);\n    window.CharacterVoiceOwner?.bindStop?.(voiceClaim, fadeS => _fadeNpcSpeechHandle(handle, fadeS));\n    osc.onended =',
    1,
)
write('docs/js/dialogue-content.js', dlg)

# -----------------------------------------------------------------------------
# Combat vocalizations: generalize from player-only to humanoid character
# entities, share one voice slot, track per-entity breath/DoT state, spatialize
# NPC voices, and let NPC staged attacks use the same charge/release/combo cues.
# -----------------------------------------------------------------------------
cv = read('docs/js/combat/combat-vocalizations.js')
cv = replace_once(cv, '  const VERSION = 3;', '  const VERSION = 4;', 'combat vocal version')
cv = replace_once(
    cv,
    '''  let installedCombatHooks = false;
  let nextBreathAtMs = 0;
  let lastBreathIntervalS = 0;
  let lastDotPainAtMs = -Infinity;
  let activeAbilityContext = null;''',
    '''  let installedCombatHooks = false;
  let lastDotPainAtMsByEntity = new WeakMap(); // Pain cadence is per character so one NPC's DoT cannot silence another's.
  let activeAbilityContext = null;''',
    'combat per-entity transient globals',
)
cv = replace_once(
    cv,
    '  const liveChargesByAbility = new Map(); // Used by hold-release abilities to stretch one charge vocal across the full charge window.\n  const activeChargeTokens = new Set(); // Used for cleanup/debug without coupling tokens to one combat archetype.',
    '''  const liveChargesByAbility = new Map(); // Player held abilities keyed by ability id; NPC attacks use per-action tokens below.
  const activeChargeTokens = new Set(); // Used for cleanup/debug without coupling tokens to one combat archetype.
  const trackedBreathers = new Set(); // Only non-player humanoids currently below max Stamina stay in the frame scheduler set.
  const breathStateByEntity = new WeakMap(); // Per-character cadence prevents NPCs from sharing the player's next-breath clock.
  const VOICE_FADE_OUT_S = 0.008; // Same sudden anti-pop handoff used by dialogue ownership.
  const BREATH_RETRY_AFTER_SUPPRESSION_MS = 100; // Resume passive breathing promptly once pain/attack vocals release the mouth.''',
    'combat voice owner globals',
)

old_identity = '''  function playerVoiceIdentity() {
    const appearance = window.__hobunjiPlayerProfile?.appearance || {};
    return {
      speciesId: String(appearance.speciesId || 'default'),
      gender: appearance.gender === 'female' ? 'female' : 'male',
    };
  }

  function voiceModulation() {
    const { speciesId, gender } = playerVoiceIdentity();
    const root = config.utteranceModulation || {};
    const fallback = root.default?.[gender] || root.default?.male || {};
    const authored = root.species?.[speciesId]?.[gender] || {};
    return {
      speciesId,
      gender,
      pitchSemitones: Number(authored.pitchSemitones ?? fallback.pitchSemitones ?? 0) || 0,
      tempo: clamp(authored.tempo ?? fallback.tempo ?? 1, 0.35, 3),
      gain: clamp(authored.gain ?? fallback.gain ?? 1, 0, 3),
    };
  }
'''
new_identity = '''  function appearanceForEntity(entity) {
    if (entity === player()) return window.__hobunjiPlayerProfile?.appearance || {};
    return entity?.rosterRecord?.appearance
      || entity?.rec?.appearance
      || entity?.npcRecord?.appearance
      || entity?.appearance
      || {};
  }

  function isHumanoidVocalEntity(entity) {
    if (!entity) return false;
    if (entity === player()) return true;
    const appearance = appearanceForEntity(entity);
    return !!(appearance?.speciesId || entity?.npcId || entity?.rosterRecord?.appearance || entity?.rec?.appearance);
  }

  function voiceIdentity(entity = player()) {
    const appearance = appearanceForEntity(entity);
    return {
      speciesId: String(appearance.speciesId || 'default'),
      gender: appearance.gender === 'female' ? 'female' : 'male',
    };
  }

  function voiceModulation(entity = player()) {
    const { speciesId, gender } = voiceIdentity(entity);
    const root = config.utteranceModulation || {};
    const fallback = root.default?.[gender] || root.default?.male || {};
    const authored = root.species?.[speciesId]?.[gender] || {};
    return {
      speciesId,
      gender,
      pitchSemitones: Number(authored.pitchSemitones ?? fallback.pitchSemitones ?? 0) || 0,
      tempo: clamp(authored.tempo ?? fallback.tempo ?? 1, 0.35, 3),
      gain: clamp(authored.gain ?? fallback.gain ?? 1, 0, 3),
    };
  }
'''
cv = replace_once(cv, old_identity, new_identity, 'combat entity voice identity')
cv = replace_once(
    cv,
    '''  function voicePlaybackPlan(randomSemitones = 0) {
    const mod = voiceModulation();''',
    '''  function voicePlaybackPlan(randomSemitones = 0, entity = player()) {
    const mod = voiceModulation(entity);''',
    'combat voice plan entity',
)

# Replace playOneShot wholesale.
start = cv.index('  function playOneShot(')
end = cv.index('\n  function recordPlaybackFailure', start)
new_play = r'''  function voicePriority(kind) {
    const shared = window.CharacterVoiceOwner?.priorities || {};
    if (kind === 'active') return Number(shared.active ?? 3);
    if (kind === 'pain') return Number(shared.pain ?? 2);
    return Number(shared.breath ?? 1);
  }

  function voiceSpatialOptions(entity) {
    if (!entity || entity === player()) return { panX: 0, extraWetBoost: 0, area: entity?.areaId || entity?.area || null };
    const spatial = window.AudioSystem?.creatureAudioSpatial?.(entity, {}) || {};
    return {
      panX: clamp(spatial.panX ?? 0, -1, 1),
      extraWetBoost: Math.max(0, Number(spatial.extraWetBoost) || 0),
      area: entity.areaId || entity.area || null,
    };
  }

  function fadeNativeVoice(audio, fadeOutS = VOICE_FADE_OUT_S, onFinished = null) {
    if (!audio) { onFinished?.(); return; }
    const fade = Math.max(0, Number(fadeOutS) || 0);
    if (!(fade > 0)) {
      try { audio.pause?.(); audio.currentTime = 0; } catch (_) {}
      onFinished?.();
      return;
    }
    const startVolume = Math.max(0, Number(audio.volume) || 0);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - startedAt) / Math.max(1, fade * 1000));
      try { audio.volume = startVolume * (1 - t); } catch (_) {}
      if (t < 1) return;
      clearInterval(timer);
      try { audio.pause?.(); audio.currentTime = 0; } catch (_) {}
      onFinished?.();
    }, 2);
  }

  function playOneShot(entity, url, baseVolume, pitchRandomSemitones, debugKind, detail = {}, voiceKind = 'active') {
    if (!url || !isHumanoidVocalEntity(entity)) return null;
    const audio = audioConfig();
    if (audio.enabled === false || Number(audio.sfxVolume ?? 1) <= 0) return null;
    const claim = window.CharacterVoiceOwner?.request?.(entity, {
      kind: voiceKind,
      priority: voicePriority(voiceKind),
      fadeOutS: VOICE_FADE_OUT_S,
    }) || null;
    if (window.CharacterVoiceOwner && !claim) return { suppressed: true, reason: 'voice-priority', voiceKind, ...detail };

    const plan = voicePlaybackPlan(randomPitchSemitones(pitchRandomSemitones), entity);
    const volume = clamp(
      Number(baseVolume ?? 1) * plan.modulation.gain * Number(audio.sfxVolume ?? 1),
      0,
      1,
    );
    const spatial = voiceSpatialOptions(entity);
    const finish = () => window.CharacterVoiceOwner?.release?.(claim);
    let snd = null;
    try {
      const renderer = window.AnimalVoiceIndependentPlayback?.playIndependent
        || window.AnimalVoiceIndependentPlayback?.play;
      if (renderer) {
        snd = renderer(url, {
          tempo: plan.tempo,
          pitchSemitones: plan.pitchSemitones,
          volume,
          trimSilence: true,
          tailPadS: 0,
          extraWetBase: 0, // Character combat voices use the area's normal wet profile; NPC distance contributes only the shared distance wet boost.
          panX: spatial.panX,
          extraWetBoost: spatial.extraWetBoost,
          area: spatial.area,
          onFinished: finish,
        });
        window.CharacterVoiceOwner?.bindStop?.(claim, fadeS => snd?.stop?.(fadeS));
      } else if (typeof Audio === 'function') {
        snd = new Audio(url);
        snd.volume = volume;
        setPitchPreservation(snd, true);
        snd.playbackRate = plan.tempo;
        snd.addEventListener?.('ended', finish, { once: true });
        window.CharacterVoiceOwner?.bindStop?.(claim, fadeS => fadeNativeVoice(snd, fadeS, finish));
        const result = snd.play();
        result?.catch?.(error => { finish(); recordPlaybackFailure(debugKind, error, url); });
      }
    } catch (error) {
      finish();
      recordPlaybackFailure(debugKind, error, url);
      return null;
    }
    if (!snd) finish();
    return {
      snd,
      claim,
      entity,
      tempo: plan.tempo,
      pitchSemitones: plan.pitchSemitones,
      modulation: plan.modulation,
      independentPitch: true,
      suppressed: false,
      ...detail,
    };
  }
'''
cv = cv[:start] + new_play + cv[end:]

# Replace breathing functions with per-entity service.
start = cv.index('  function playBreath(')
end = cv.index('\n  function choosePainIntensity', start)
new_breath = r'''  function playBreath(entity, atMs) {
    const intensity = chooseBreathIntensity(entity);
    const url = config.assets?.breath?.[intensity];
    const played = playOneShot(
      entity,
      url,
      config.breath?.volume ?? 0.72,
      config.breath?.pitchRandomSemitones ?? 0,
      'breath',
      { intensity },
      'breath',
    );
    debug.lastBreath = {
      atMs: Math.round(atMs),
      entity: entity?.id || entity?.npcId || entity?.name || (entity === player() ? 'player' : 'npc'),
      intensity,
      stamina: Number(entity.stamina) || 0,
      maxStamina: Number(entity.maxStamina) || 0,
      exhausted: !!entity.exhaustion?.active,
      suppressed: !!played?.suppressed,
      tempo: played?.tempo ?? null,
      pitchSemitones: played?.pitchSemitones ?? null,
    };
    return played;
  }

  function trackBreather(entity) {
    if (!isHumanoidVocalEntity(entity) || !(Number(entity?.maxStamina) > 0) || !(Number(entity?.health) > 0)) return;
    if (entity.exhaustion?.active || Number(entity.stamina) < Number(entity.maxStamina)) trackedBreathers.add(entity);
  }

  function breathState(entity) {
    let state = breathStateByEntity.get(entity);
    if (!state) {
      state = { nextAtMs: 0, lastIntervalS: 0 };
      breathStateByEntity.set(entity, state);
    }
    return state;
  }

  function serviceBreathing(entity, atMs) {
    if (!isHumanoidVocalEntity(entity) || !(Number(entity?.maxStamina) > 0) || !(Number(entity?.health) > 0)) {
      trackedBreathers.delete(entity);
      return;
    }
    const state = breathState(entity);
    if (!entity.exhaustion?.active && Number(entity.stamina) >= Number(entity.maxStamina)) {
      state.nextAtMs = 0;
      state.lastIntervalS = 0;
      trackedBreathers.delete(entity);
      return; // Full-stamina fast path: no profile/intensity/audio work.
    }
    if (entity !== player()) trackedBreathers.add(entity);

    const intervalS = breathIntervalS(entity);
    if (!(state.nextAtMs > 0)) {
      const played = playBreath(entity, atMs);
      if (played?.suppressed) {
        state.nextAtMs = atMs + BREATH_RETRY_AFTER_SUPPRESSION_MS;
        return;
      }
      state.lastIntervalS = intervalS;
      state.nextAtMs = atMs + intervalS * 1000;
      return;
    }
    if (intervalS < state.lastIntervalS) state.nextAtMs = Math.min(state.nextAtMs, atMs + intervalS * 1000);
    state.lastIntervalS = intervalS;
    if (atMs < state.nextAtMs) return;

    const played = playBreath(entity, atMs);
    if (played?.suppressed) {
      state.nextAtMs = atMs + BREATH_RETRY_AFTER_SUPPRESSION_MS;
      return;
    }
    state.nextAtMs = atMs + intervalS * 1000;
  }

  function breathFrame(frameContext) {
    const atMs = Number(frameContext?.timestamp) || nowMs();
    const p = player();
    if (p) serviceBreathing(p, atMs);
    for (const entity of [...trackedBreathers]) {
      if (entity === p) continue;
      serviceBreathing(entity, atMs);
    }
  }
'''
cv = cv[:start] + new_breath + cv[end:]

# Pain generalization and per-entity DoT cadence.
cv = cv.replace('  function playPain(p, kind, delta, atMs) {', '  function playPain(entity, kind, delta, atMs) {', 1)
cv = cv.replace('    const intensity = choosePainIntensity(p);', '    const intensity = choosePainIntensity(entity);', 1)
cv = cv.replace(
    '''    const played = playOneShot(
      config.assets?.pain?.[intensity],''',
    '''    const played = playOneShot(
      entity,
      config.assets?.pain?.[intensity],''',
    1,
)
cv = cv.replace("      { intensity, kind },\n    );", "      { intensity, kind },\n      'pain',\n    );", 1)
cv = cv.replace('      health: Number(p.health) || 0,\n      maxHealth: Number(p.maxHealth) || 0,', '      entity: entity?.id || entity?.npcId || entity?.name || (entity === player() ? \'player\' : \'npc\'),\n      health: Number(entity.health) || 0,\n      maxHealth: Number(entity.maxHealth) || 0,\n      suppressed: !!played?.suppressed,', 1)
old_resource = '''  function onResourceChange(event) {
    const detail = event?.detail || {};
    const p = player();
    if (!p || detail.entity !== p || !(Number(detail.delta) < 0)) return;
    const atMs = nowMs();
    if (detail.immediate === true) {
      playPain(p, 'direct', Number(detail.delta) || 0, atMs);
      return;
    }
    const repeatMs = Math.max(100, (Number(config.pain?.dotRepeatS) || 1) * 1000);
    if (atMs - lastDotPainAtMs < repeatMs) return;
    lastDotPainAtMs = atMs;
    playPain(p, 'dot', Number(detail.delta) || 0, atMs);
  }
'''
new_resource = '''  function onResourceChange(event) {
    const detail = event?.detail || {};
    const entity = detail.entity;
    if (!isHumanoidVocalEntity(entity) || !(Number(detail.delta) < 0)) return;
    trackBreather(entity);
    const atMs = nowMs();
    if (detail.immediate === true) {
      playPain(entity, 'direct', Number(detail.delta) || 0, atMs);
      return;
    }
    const repeatMs = Math.max(100, (Number(config.pain?.dotRepeatS) || 1) * 1000);
    const previous = Number(lastDotPainAtMsByEntity.get(entity));
    if (Number.isFinite(previous) && atMs - previous < repeatMs) return;
    lastDotPainAtMsByEntity.set(entity, atMs);
    playPain(entity, 'dot', Number(detail.delta) || 0, atMs);
  }
'''
cv = replace_once(cv, old_resource, new_resource, 'generic resource pain')

# Charge output spatializes NPCs and uses entity modulation.
cv = replace_once(cv, '  function chargeOutputGain(ctx) {\n    const audio = audioConfig();\n    const mod = voiceModulation();', '  function chargeOutputGain(ctx, entity) {\n    const audio = audioConfig();\n    const mod = voiceModulation(entity);', 'charge output entity')
cv = replace_once(
    cv,
    '''    gain.connect(ctx.destination);
    gain.__combatVocalWet = window.EnvironmentalReverb?.connectWetNode?.(ctx, gain, { volume: 1 }) || null; // Charge grunts use the same room/cavern/temple acoustic space as ordinary world SFX.
    return gain;''',
    '''    const spatial = voiceSpatialOptions(entity);
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = spatial.panX;
      gain.connect(panner);
      panner.connect(ctx.destination);
      gain.__combatVocalPanner = panner;
    } else gain.connect(ctx.destination);
    gain.__combatVocalWet = window.EnvironmentalReverb?.connectWetNode?.(ctx, gain, { volume: 1, extraWet: spatial.extraWetBoost, area: spatial.area }) || null; // NPC charge grunts originate from their world position and still use the current physical acoustic space.
    return gain;''',
    'charge spatial output',
)

# Replace finish/cancel charge block with fade-aware shared ownership cleanup.
start = cv.index('function finishChargeToken(token)')
end = cv.index('\nfunction releaseCharge(token)', start)
new_charge_stop = r'''function finishChargeToken(token) {
  if (!token || token.done) return;
  token.done = true;
  clearTimeout(token.stopTimer);
  activeChargeTokens.delete(token);
  window.CharacterVoiceOwner?.release?.(token.voiceClaim);
  try { token.output?.__combatVocalWet?.send?.disconnect?.(); } catch (_) {}
  try { token.output?.__combatVocalPanner?.disconnect?.(); } catch (_) {}
  try { token.output?.disconnect?.(); } catch (_) {}
}

function stopChargeToken(token, fadeOutS = VOICE_FADE_OUT_S, action = 'cancel') {
  if (!token || token.cancelled || token.done) return;
  token.cancelled = true;
  const fade = Math.max(0, Number(fadeOutS) || 0);
  if (token.ctx && token.source && token.output?.gain && fade > 0) {
    const at = token.ctx.currentTime;
    try {
      const param = token.output.gain;
      if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
      else {
        param.cancelScheduledValues?.(at);
        param.setValueAtTime(Math.max(0.0001, Number(param.value) || 0.0001), at);
      }
      param.linearRampToValueAtTime(0.0001, at + fade);
      stopSource(token.source, at + fade + 0.001);
      token.stopTimer = setTimeout(() => finishChargeToken(token), Math.ceil((fade + 0.004) * 1000));
    } catch (_) {
      stopSource(token.source);
      finishChargeToken(token);
    }
  } else {
    stopSource(token.source);
    finishChargeToken(token);
  }
  debug.lastCharge = {
    id: token.id,
    action,
    abilityId: token.abilityId,
    entity: token.entity?.id || token.entity?.npcId || token.entity?.name || (token.entity === player() ? 'player' : 'npc'),
    atMs: Math.round(nowMs()),
  };
}

function cancelCharge(token) {
  stopChargeToken(token, VOICE_FADE_OUT_S, 'cancel');
}
'''
cv = cv[:start] + new_charge_stop + cv[end:]

# beginCharge: entity + claim before async render, release if unavailable.
cv = replace_once(
    cv,
    '''function beginCharge(options = {}) {
  const requestedTarget = options.targetDurationS ?? options.durationS;
  const token = {''',
    '''function beginCharge(options = {}) {
  const requestedTarget = options.targetDurationS ?? options.durationS;
  const entity = options.entity || player();
  const token = {''',
    'charge begin entity',
)
cv = replace_once(
    cv,
    '''    id: ++chargeTokenSerial,
    abilityId: options.abilityId || null,''',
    '''    id: ++chargeTokenSerial,
    entity,
    abilityId: options.abilityId || null,''',
    'charge token entity',
)
cv = replace_once(
    cv,
    '''  };
  activeChargeTokens.add(token);

  preloadChargeBuffer().then(async buffer => {''',
    '''  };
  if (!isHumanoidVocalEntity(entity)) { token.done = true; token.suppressed = true; return token; }
  token.voiceClaim = window.CharacterVoiceOwner?.request?.(entity, {
    kind: 'active',
    priority: voicePriority('active'),
    fadeOutS: VOICE_FADE_OUT_S,
  }) || null;
  if (window.CharacterVoiceOwner && !token.voiceClaim) { token.done = true; token.suppressed = true; return token; }
  window.CharacterVoiceOwner?.bindStop?.(token.voiceClaim, fadeS => stopChargeToken(token, fadeS, 'priority-preempted'));
  trackBreather(entity);
  activeChargeTokens.add(token);

  preloadChargeBuffer().then(async buffer => {''',
    'charge shared claim',
)
cv = replace_once(
    cv,
    '''    if (!buffer || token.cancelled || token.released || token.done) {
      activeChargeTokens.delete(token);
      return;
    }''',
    '''    if (!buffer || token.cancelled || token.released || token.done) {
      finishChargeToken(token);
      return;
    }''',
    'charge no-buffer ownership cleanup',
)
cv = replace_once(cv, '    const voice = voicePlaybackPlan(randomPitchSemitones(config.grunts?.pitchRandomSemitones ?? 0));', '    const voice = voicePlaybackPlan(randomPitchSemitones(config.grunts?.pitchRandomSemitones ?? 0), entity);', 'charge entity modulation')
cv = replace_once(cv, '    const output = chargeOutputGain(ctx);', '    const output = chargeOutputGain(ctx, entity);', 'charge entity output')

# Strike grunt gets explicit entity and active priority.
cv = replace_once(cv, '  function playStrikeGrunt(category, abilityId) {', '  function playStrikeGrunt(entity, category, abilityId) {', 'strike entity signature')
cv = replace_once(
    cv,
    '''    const played = playOneShot(
      url,''',
    '''    const played = playOneShot(
      entity,
      url,''',
    'strike entity one-shot',
)
# This is the strike call's detail; choose the occurrence nearest playStrikeGrunt.
strike_marker = "      { abilityId, category },\n    );\n    debug.lastStrike"
if strike_marker not in cv:
    raise RuntimeError('strike detail marker missing')
cv = cv.replace(strike_marker, "      { abilityId, category },\n      'active',\n    );\n    debug.lastStrike", 1)
cv = cv.replace('      abilityId,\n      category,\n      url,', "      entity: entity?.id || entity?.npcId || entity?.name || (entity === player() ? 'player' : 'npc'),\n      abilityId,\n      category,\n      url,", 1)

# Generic staged-action context: player wrappers + NPC/bandit/minion metadata all flow through one path.
start = cv.index('  function wrapBeginStagedAction()')
end = cv.index('\n  function wrapAbilityDefinition', start)
new_wrap = r'''  function stagedVoiceContext(spec = {}) {
    if (activeAbilityContext) return { ...activeAbilityContext, entity: player() };
    const entity = spec.data?.attacker || null;
    const category = spec.data?.voiceCategory || null;
    if (!isHumanoidVocalEntity(entity) || !isOffensiveVocalCategory(category)) return null;
    return {
      entity,
      id: spec.data?.voiceAbilityId || spec.data?.comboId || 'npcAttack',
      category,
      phase: 'npc-staged-action',
    };
  }

  function wrapBeginStagedAction() {
    if (!window.Combat?.beginStagedAction || window.Combat.beginStagedAction.__combatVocalWrapped) return;
    originalBeginStagedAction = window.Combat.beginStagedAction;
    const wrapped = function combatVocalStagedAction(spec = {}) {
      const context = stagedVoiceContext(spec);
      if (!context) return originalBeginStagedAction.call(this, spec);
      trackBreather(context.entity);

      let charge = context.entity === player() ? (liveChargesByAbility.get(context.id) || null) : null;
      if (charge) {
        liveChargesByAbility.delete(context.id);
        releaseCharge(charge); // Held player release keeps the same conceptual vocal playhead for catch-up.
      } else {
        const preImpactS = Math.max(0, Number(spec.windupS) || 0) + Math.max(0, Number(spec.strikeS) || 0);
        if (preImpactS > 0) {
          charge = beginCharge({ entity: context.entity, targetDurationS: preImpactS, abilityId: context.id, category: context.category });
        }
      }

      const originalStrike = spec.onStrike;
      const originalCancel = spec.onCancel;
      return originalBeginStagedAction.call(this, {
        ...spec,
        onStrike: (...args) => {
          Promise.resolve(charge).then(token => releaseCharge(token));
          playStrikeGrunt(context.entity, context.category, context.id);
          return originalStrike?.(...args);
        },
        onCancel: (...args) => {
          Promise.resolve(charge).then(token => cancelCharge(token));
          return originalCancel?.(...args);
        },
      });
    };
    wrapped.__combatVocalWrapped = true;
    window.Combat.beginStagedAction = wrapped;
  }
'''
cv = cv[:start] + new_wrap + cv[end:]

# Player live hold charge passes player entity.
cv = replace_once(
    cv,
    '''            liveChargesByAbility.set(id, beginCharge({
              abilityId: id,''',
    '''            liveChargesByAbility.set(id, beginCharge({
              entity: player(),
              abilityId: id,''',
    'player live charge entity',
)

# Reset and debug use per-entity state / shared owner.
old_reset = '''  function resetTransientState() {
    nextBreathAtMs = 0;
    lastBreathIntervalS = 0;
    lastDotPainAtMs = -Infinity;
    for (const value of liveChargesByAbility.values()) Promise.resolve(value).then(token => cancelCharge(token));
    liveChargesByAbility.clear();
    for (const token of [...activeChargeTokens]) cancelCharge(token);
  }
'''
new_reset = '''  function resetTransientState() {
    lastDotPainAtMsByEntity = new WeakMap();
    trackedBreathers.clear();
    for (const value of liveChargesByAbility.values()) Promise.resolve(value).then(token => cancelCharge(token));
    liveChargesByAbility.clear();
    for (const token of [...activeChargeTokens]) cancelCharge(token);
    window.CharacterVoiceOwner?.stop?.(player(), VOICE_FADE_OUT_S);
  }
'''
cv = replace_once(cv, old_reset, new_reset, 'combat reset transient')
cv = replace_once(
    cv,
    "      description: 'Schedules player heavy-breath one-shots only while ordinary stamina is below 100%.',",
    "      description: 'Schedules player + humanoid NPC heavy breathing only while each character is below max Stamina.',",
    'breath scheduler description',
)
# API playStrikeGrunt remains exposed but now entity-first; add helper priorities and entity modulation.
cv = cv.replace('    getVoiceModulation: () => ({ ...voiceModulation() }),', '    getVoiceModulation: entity => ({ ...voiceModulation(entity || player()) }),\n    getVoicePriority: kind => voicePriority(kind),', 1)
# Replace player-global breath debug fields.
cv = replace_once(
    cv,
    '''      nextBreathInMs: nextBreathAtMs > 0 ? Math.max(0, Math.round(nextBreathAtMs - nowMs())) : null,
      lastBreathIntervalS,''',
    '''      nextBreathInMs: (() => { const p = player(); const s = p ? breathStateByEntity.get(p) : null; return s?.nextAtMs > 0 ? Math.max(0, Math.round(s.nextAtMs - nowMs())) : null; })(),
      lastBreathIntervalS: (() => { const p = player(); return p ? breathStateByEntity.get(p)?.lastIntervalS || 0 : 0; })(),
      trackedNpcBreathers: [...trackedBreathers].filter(entity => entity !== player()).length,
      activeVoiceOwner: window.CharacterVoiceOwner?.current?.(player()) || null,''',
    'combat debug breath state',
)
write('docs/js/combat/combat-vocalizations.js', cv)

# -----------------------------------------------------------------------------
# Bandit/minion shared humanoid executor: annotate staged actions with semantic
# vocal categories so the centralized Combat.beginStagedAction wrapper can give
# NPCs the exact same combo/quick/charge vocal behavior as the player.
# -----------------------------------------------------------------------------
bandit = read('docs/js/combat/combat-bandit.js')
bandit = replace_once(
    bandit,
    'data: { isBandit: true, attacker: c, comboId: loadout.tap1, comboStep, sfxPitch },',
    "data: { isBandit: true, attacker: c, comboId: loadout.tap1, comboStep, sfxPitch, voiceCategory: 'combo', voiceAbilityId: loadout.tap1 },",
    'bandit combo vocal metadata',
)
# Quick and charged both used identical data text; replace in order.
quick_old = "data: { isBandit: true, attacker: c }, // see fireBanditComboStep's matching comment"
quick_new = "data: { isBandit: true, attacker: c, voiceCategory: 'quickAttack', voiceAbilityId: loadout.tap2 }, // Shared vocal owner gives NPC quick attacks the same release grunt as the player."
bandit = replace_once(bandit, quick_old, quick_new, 'bandit quick vocal metadata')
charged_old = '      data: { isBandit: true, attacker: c },\n      onStrike: () => {'
charged_new = "      data: { isBandit: true, attacker: c, voiceCategory: 'offensiveHold', voiceAbilityId: 'chargedBreaker' },\n      onStrike: () => {"
bandit = replace_once(bandit, charged_old, charged_new, 'bandit charged vocal metadata')
write('docs/js/combat/combat-bandit.js', bandit)

# -----------------------------------------------------------------------------
# Dynamic module gate must require the new combat-vocal version.
# -----------------------------------------------------------------------------
loader = read('docs/js/combat/combat-config-loader.js')
loader = replace_once(
    loader,
    "['js/combat/combat-vocalizations.js?v=20261013vocal3', () => Number(window.CombatVocalizations?.version) >= 3]",
    "['js/combat/combat-vocalizations.js?v=20261013vocal4', () => Number(window.CombatVocalizations?.version) >= 4]",
    'combat loader version gate',
)
write('docs/js/combat/combat-config-loader.js', loader)

# -----------------------------------------------------------------------------
# Focused shared-owner regression.
# -----------------------------------------------------------------------------
owner_test = r'''const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'character-voice-owner.js'), 'utf8');
const player = { id: 'player-runtime' };
const context = { console, window: null };
context.window = context;
context.Combat = { deps: { player } };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'character-voice-owner.js' });
const owner = context.CharacterVoiceOwner;
assert(owner && owner.version >= 1, 'shared CharacterVoiceOwner must install');
assert.equal(owner.keyFor(player), 'actor:player');
assert.equal(owner.keyFor({ id: 'npc-a' }), owner.keyFor({ rec: { id: 'npc-a' } }), 'dialogue records and combat entities with the same NPC id must share one slot');

const fades = [];
const breath = owner.request(player, { kind: 'breath', priority: owner.priorities.breath });
owner.bindStop(breath, fade => fades.push(['breath', fade]));
const pain = owner.request(player, { kind: 'pain', priority: owner.priorities.pain });
owner.bindStop(pain, fade => fades.push(['pain', fade]));
assert.deepEqual(fades[0], ['breath', owner.defaultFadeOutS], 'pain must preempt breathing with the anti-pop fade');
const active = owner.request(player, { kind: 'active', priority: owner.priorities.active });
owner.bindStop(active, fade => fades.push(['active', fade]));
assert.deepEqual(fades[1], ['pain', owner.defaultFadeOutS], 'active grunt must preempt pain with the anti-pop fade');
assert.equal(owner.request(player, { kind: 'pain', priority: owner.priorities.pain }), null, 'pain cannot talk over an active grunt');
assert.equal(owner.request(player, { kind: 'breath', priority: owner.priorities.breath }), null, 'breathing cannot talk over an active grunt');
const laterActive = owner.request(player, { kind: 'active', priority: owner.priorities.active });
assert.deepEqual(fades[2], ['active', owner.defaultFadeOutS], 'same-priority active vocals replace one another cleanly');
owner.release(laterActive);
assert.equal(owner.current(player), null, 'released voice must free the character slot');
console.log('character voice owner: ok');
'''
write('scripts/test-character-voice-owner.js', owner_test)

# -----------------------------------------------------------------------------
# Extend combat regression to load shared owner and verify NPC parity + priority.
# -----------------------------------------------------------------------------
test = read('scripts/test-combat-vocalizations.js')
test = replace_once(
    test,
    "const animalPlaybackSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'animal-voice-independent-playback.js'), 'utf8');",
    "const animalPlaybackSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'animal-voice-independent-playback.js'), 'utf8');\nconst voiceOwnerSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'character-voice-owner.js'), 'utf8');\nconst banditSource = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'combat', 'combat-bandit.js'), 'utf8');",
    'combat test shared sources',
)
# Renderer stub records callbacks/fade stops.
old_stub = '''context.window.AnimalVoiceIndependentPlayback = {
  playIndependent(url, opts = {}) {
    played.push({ url, ...opts, pitchPreserved: true });
    return { stop() {} };
  },
};'''
new_stub = '''context.window.AnimalVoiceIndependentPlayback = {
  playIndependent(url, opts = {}) {
    const entry = { url, ...opts, pitchPreserved: true, stopped: false, fadeOutS: null, handle: null };
    let finished = false;
    const finish = () => { if (finished) return; finished = true; opts.onFinished?.(); };
    const handle = {
      stop(fadeOutS = 0) { entry.stopped = true; entry.fadeOutS = fadeOutS; finish(); },
      finish,
    };
    entry.handle = handle;
    played.push(entry);
    return handle;
  },
};'''
test = replace_once(test, old_stub, new_stub, 'combat test renderer stub')
# Spatial API in AudioSystem harness.
test = replace_once(
    test,
    "context.window.AudioSystem = {\n  gameAudioConfig: () => ({ enabled: true, sfxVolume: 1 }),",
    "context.window.AudioSystem = {\n  gameAudioConfig: () => ({ enabled: true, sfxVolume: 1 }),\n  creatureAudioSpatial: entity => ({ panX: entity === player ? 0 : 0.5, extraWetBoost: entity === player ? 0 : 0.2, distance: entity === player ? 0 : 100 }),",
    'combat test spatial API',
)
# Load owner before combat module.
test = replace_once(
    test,
    "vm.createContext(context);\nvm.runInContext(source, context, { filename: 'combat-vocalizations.js' });",
    "vm.createContext(context);\nvm.runInContext(voiceOwnerSource, context, { filename: 'character-voice-owner.js' });\nvm.runInContext(source, context, { filename: 'combat-vocalizations.js' });",
    'combat test owner load',
)
test = test.replace("assert.equal(context.window.CombatVocalizations.version, 3);", "assert.equal(context.window.CombatVocalizations.version, 4);", 1)
# Add static metadata/fade assertions after existing reverb assertions.
needle = "assert.match(source, /__combatVocalWet = window\\.EnvironmentalReverb\\?\\.connectWetNode/, 'custom charge playback also sends into the current environmental reverb space');"
if needle not in test:
    raise RuntimeError('combat test reverb marker missing')
test = test.replace(needle, needle + "\nassert.match(animalPlaybackSource, /function stop\\(fadeOutS = 0\\)/, 'shared processed voice handles must support click-safe fade stops');\nassert.match(banditSource, /voiceCategory: 'combo'/, 'NPC combo attacks must carry semantic vocal metadata');\nassert.match(banditSource, /voiceCategory: 'quickAttack'/, 'NPC quick attacks must carry semantic vocal metadata');\nassert.match(banditSource, /voiceCategory: 'offensiveHold'/, 'NPC charged attacks must carry semantic vocal metadata');", 1)
# Append priority/NPC parity scenarios before final debug snapshot.
insert_before = "const debug = context.window.CombatVocalizations.debugSnapshot();"
if insert_before not in test:
    raise RuntimeError('combat test debug marker missing')
extra = r'''
// One owned voice per character: active grunts beat pain and breathing.
const priorityPlayer = context.window.CombatVocalizations.playStrikeGrunt(player, 'combo', 'priority-test');
const activeEntry = played.at(-1);
const beforeSuppressedPain = played.length;
emit(listeners, 'hobunji-resource-change', { entity: player, delta: -3, immediate: true, reason: 'priority-test-hit' });
assert.equal(played.length, beforeSuppressedPain, 'damage vocal must not overlap an active grunt from the same character');
player.stamina = 5;
scheduledBreath({ timestamp: 41000 });
assert.equal(played.length, beforeSuppressedPain, 'breathing must not overlap an active grunt from the same character');
activeEntry.handle.finish();
scheduledBreath({ timestamp: 41150 });
assert.equal(played.length, beforeSuppressedPain + 1, 'suppressed breathing should retry promptly after the active voice releases');
played.at(-1).handle.finish();

// NPCs use the same species/gender modulation, spatial acoustics, damage voice,
// breathing loop, and staged attack grunts as the player.
const npc = {
  id: 'npc-voice-test', name: 'NPC Voice Test', x: 12, y: 7, areaId: 'test-area',
  health: 80, maxHealth: 100, stamina: 35, maxStamina: 100,
  exhaustion: { active: false, blackStamina: 100 },
  rosterRecord: { appearance: { speciesId: 'tletingan', gender: 'female' } },
};
now = 50000;
const beforeNpcPain = played.length;
emit(listeners, 'hobunji-resource-change', { entity: npc, delta: -5, immediate: true, reason: 'npc-hit' });
assert.equal(played.length, beforeNpcPain + 1, 'humanoid NPC direct damage should vocalize');
assert(played.at(-1).pitchSemitones > 7.5, 'NPC pain uses the NPC species/gender pitch profile');
assert.equal(played.at(-1).panX, 0.5, 'NPC voice uses world-position stereo panning');
assert.equal(played.at(-1).extraWetBoost, 0.2, 'NPC voice uses distance-aware environmental wet boost');
assert.equal(played.at(-1).area, 'test-area', 'NPC voice forwards its physical area to reverb');
played.at(-1).handle.finish();

scheduledBreath({ timestamp: 51000 });
assert(played.at(-1).url.includes('heavybreath_'), 'tracked winded NPC should emit heavy breathing');
assert(played.at(-1).pitchSemitones > 7.5, 'NPC breathing uses NPC species/gender pitch');
played.at(-1).handle.finish();

const npcAttackBefore = played.length;
context.window.Combat.beginStagedAction({
  windupS: 0.1, strikeS: 0.05,
  data: { isBandit: true, attacker: npc, voiceCategory: 'combo', voiceAbilityId: 'swingCombo' },
  onStrike() { context.window.__npcStrike = (context.window.__npcStrike || 0) + 1; },
});
stagedSpec.onStrike();
assert.equal(context.window.__npcStrike, 1, 'NPC original staged strike still executes');
assert.equal(played.length, npcAttackBefore + 1, 'NPC staged combo strike should emit the attack grunt');
assert(played.at(-1).url.includes('sfx_attackgrunt_1'));
assert(played.at(-1).pitchSemitones > 7.5, 'NPC attack grunt uses NPC species/gender pitch');
'''
test = test.replace(insert_before, extra + '\n' + insert_before, 1)
write('scripts/test-combat-vocalizations.js', test)

print('character voice priority/NPC parity patch applied')
