// Baby-specific ambient speech policy. Loaded after family-baby-burdens and before romance-family;
// only these small public bridge calls are needed by the general family/ambient systems.
(() => {
  'use strict';
  if (window.FamilyBabyAmbientVoice) return;

  const defaultBabble = Object.freeze(['Agoo!', 'Guh-buh!', 'Baba-ba!', 'Ahh-oo!']); // Fallback phonetics used if a custom family config lacks babyAmbientNoises.
  const defaultToddler = Object.freeze(['Da! Da!', 'Up! Up!']); // First-word fallback used only for the toddler speech phase.
  const olderChildGreetings = Object.freeze(['Hi {targetName}!', 'Hiya!', 'Look what I found!', 'Can we play later?']); // Established floating greetings after toddlerhood.
  const registeredPhases = new Map(); // Child ID to last registered stage, avoiding redundant config rewrites on family ticks.

  function linesOrFallback(lines, fallback) {
    const valid = Array.isArray(lines) ? lines.filter(line => typeof line === 'string' && line.trim()) : [];
    return valid.length ? valid : fallback;
  }

  function sound(npcId, isNewborn, config = {}, random = Math.random) {
    if (!npcId || !isNewborn) return null; // The saved family stage remains authoritative in RomanceFamily, not a guessed name or sprite.
    const choices = linesOrFallback(config.babyAmbientNoises, defaultBabble);
    const roll = Number(random());
    const index = Math.min(choices.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * choices.length)));
    return choices[index]; // Exact phonetic syllables; no synonym, narration or adult greeting interpolation.
  }

  function sync(npcId, phase, config = {}) {
    const id = String(npcId || ''); // Existing saved family NPC id, used as AmbientDialogue's canonical speaker key.
    if (!id || (phase !== 'basket' && phase !== 'toddler' && phase !== 'child')) return false;
    if (registeredPhases.get(id) === phase) return true;
    const pool = phase === 'basket' ? linesOrFallback(config.babyAmbientNoises, defaultBabble)
      : phase === 'toddler' ? linesOrFallback(config.toddlerAmbientGreetings, defaultToddler)
      : olderChildGreetings;
    const registered = window.AmbientDialogue?.setNpcGreetings?.(id, { player: [...pool] });
    if (registered) registeredPhases.set(id, phase); // Retry on the next family tick if ambient dialogue is not initialized yet.
    return !!registered;
  }

  function clear() {
    for (const id of registeredPhases.keys()) window.AmbientDialogue?.setNpcGreetings?.(id, null); // Removing a prior world child's pool cannot disturb static NPC greetings.
    registeredPhases.clear();
  }

  function anchorFor(npcId) {
    if (!window.FamilyBabyBurdens?.carrying?.(npcId)) return null;
    const burden = window.Shattercasks?.getBurden?.('family_baby_' + npcId); // Existing burden registry owns the current-area mesh; no additional method on FamilyBabyBurdens.
    return burden?.group?.visible && !burden.flying ? burden : null; // Hidden/airborne proxies must not produce speech from the distant basket walker.
  }

  function isProxyActive(npcId) {
    return !!window.FamilyBabyBurdens?.isProxyActive?.(npcId); // Leverage the original carried/thrown rule without altering baby-burden internals.
  }

  window.FamilyBabyAmbientVoice = Object.freeze({ sound, sync, clear, anchorFor, isProxyActive });
})();
