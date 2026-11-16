// Fey magic: its target experiences imaginary wounds, blood, pain and fear.
// Only ResourceSystem's nonlethal mind-affliction / timed-debuff APIs are used.
// Physical weapon impact damage is owned by the ordinary Combat attack path.
(() => {
  'use strict';
  if (window.FeyIllusions) return;

  const EFFECTS = Object.freeze({
    feyPhantomWound: Object.freeze({
      label: 'Phantom Wounds', affliction: 'phantomWoundsHealth', buildup: 7.5,
      debuffs: Object.freeze([{ id: 'disoriented', durationS: 6.5 }]),
      text: 'You see deep wounds where there are none.',
    }),
    feyFalseBleeding: Object.freeze({
      label: 'False Bleeding', affliction: 'phantomBloodHealth', buildup: 9,
      debuffs: Object.freeze([{ id: 'sapped', durationS: 7 }]),
      text: 'You see your own blood flowing, but you are not bleeding.',
    }),
    feyNeedlePain: Object.freeze({
      label: 'Needle Pain', affliction: 'phantomPainFooting', buildup: 7,
      debuffs: Object.freeze([{ id: 'trembling', durationS: 7 }]),
      text: 'You feel piercing pain without injury.',
    }),
    feyMazeStep: Object.freeze({
      label: 'Maze-Step', affliction: null, buildup: 0,
      debuffs: Object.freeze([{ id: 'disoriented', durationS: 9 }]),
      text: 'The ground seems to tilt and twist under your feet.',
    }),
    feyEchoDread: Object.freeze({
      label: 'Echo Dread', affliction: null, buildup: 0,
      debuffs: Object.freeze([{ id: 'startled', durationS: 8 }, { id: 'enfeebled', durationS: 8 }]),
      text: 'You sense a dreadful blow that never actually landed.',
    }),
  });

  const BANE_ICONS = Object.freeze({
    phantomWoundsHealth: '🩹', phantomBloodHealth: '🩸', phantomPainFooting: '✴',
  }); // Existing HUD buff bar uses these in addition to ResourceSystem's resource-ring segments.
  let refreshHandle = null; // A single timer refreshes player-only hallucination presentation until all Fey symptoms clear.
  let visualElement = null; // Optional pointer-transparent red veil (visible only to afflicted player; not shared combat damage).
  let lastEffect = null; // Mobile diagnostics keep the most recent applied illusion.
  let registered = false; // Avoids installing multiple providers if this script is reinitialized in a tool preview.

  function ensureBuffProvider() {
    if (registered) return true;
    const register = window.EffectBuffBar?.registerProvider; // Combat's Fey script loads before EffectBuffBar in docs/index.html.
    if (typeof register !== 'function') return false; // Defer until the existing HUD owner becomes available; never install a second bar.
    registered = register('fey-illusions', playerSymptoms) === true;
    return registered;
  }

  function random() { return window.GameRandom?.random?.() ?? Math.random(); }

  function potency(weaponKey) {
    // Neutral to all positive Immundanity changes. If another system explicitly
    // suppresses enchantment effects to 0%, Fey fails rather than bypassing it.
    const power = Number(window.EnchantmentSystem?.getEnchantmentPowerMultiplier?.(weaponKey));
    return Number.isFinite(power) && power <= 0 ? 0 : 1;
  }

  function apply(id, target, options = {}) {
    const effect = EFFECTS[id];
    const rs = window.ResourceSystem;
    if (!effect || !target || !(Number(target.health) > 0) || !rs || !potency(options.weaponKey)) return false;
    ensureBuffProvider(); // Lazy registration fixes parser order: combat-main precedes effect-buff-bar.js.
    let didApply = false; // Real effects require a living actual target; none of these calls touch Health or Footing totals.
    if (effect.affliction && typeof rs.addAffliction === 'function') {
      const before = rs.getAffliction?.(target, effect.affliction) || 0;
      rs.addAffliction(target, effect.affliction, effect.buildup);
      didApply = (rs.getAffliction?.(target, effect.affliction) || 0) > before;
    }
    for (const debuff of effect.debuffs) {
      const applied = rs.applyTimedDebuff?.(target, debuff.id, debuff.durationS, {
        power: 1, stacks: 1, source: 'fey:' + id,
      });
      didApply = !!applied || didApply;
    }
    if (!didApply) return false;
    lastEffect = { id, label: effect.label, weaponKey: options.weaponKey || null, description: effect.text };
    window.EnchantmentSystem?.logEvent?.('Fey illusion: ' + effect.label + ' (no magical Health damage)');
    if (target === window.Combat?.deps?.player) {
      showPerceivedInjury();
      window.EffectBuffBar?.refresh?.();
    }
    return true;
  }

  function playerSymptoms() {
    const p = window.Combat?.deps?.player;
    const rs = window.ResourceSystem;
    if (!p || !rs) return [];
    const active = [];
    for (const [id, icon] of Object.entries(BANE_ICONS)) {
      const amount = Number(rs.getAffliction?.(p, id)) || 0;
      if (amount > 0) active.push({
        key: id, label: rs.AFFLICTIONS[id]?.name || id, icon, kind: 'bane',
        sourceLabel: 'Fey · sensory illusion, not real injury',
        description: rs.AFFLICTIONS[id]?.desc || 'An unreal sensation.',
        stacks: 1, timeBasis: 'conditional', remainingLabel: 'Until perception clears',
        remainingS: 1, durationS: 1,
      });
    }
    return active;
  }

  function showPerceivedInjury() {
    if (typeof document === 'undefined') return;
    if (!visualElement) {
      visualElement = document.createElement('div'); // One pooled overlay, never an element created per strike/frame.
      visualElement.id = 'fey-perceived-injury';
      visualElement.setAttribute('aria-hidden', 'true');
      visualElement.style.cssText = [
        'position:fixed', 'inset:0', 'pointer-events:none', 'z-index:104',
        'opacity:0', 'transition:opacity .45s ease',
        'background:radial-gradient(ellipse at 20% 65%,transparent 30%,rgba(116,0,30,.30) 100%),',
        'linear-gradient(102deg,transparent 5%,rgba(170,0,25,.13) 9%,transparent 12%,',
        'transparent 71%,rgba(157,0,25,.11) 77%,transparent 79%)',
      ].join(';');
      document.body.appendChild(visualElement);
    }
    if (refreshHandle !== null) return;
    const tick = () => {
      const p = window.Combat?.deps?.player;
      const rs = window.ResourceSystem;
      const blood = Number(rs?.getAffliction?.(p, 'phantomBloodHealth')) || 0;
      const wound = Number(rs?.getAffliction?.(p, 'phantomWoundsHealth')) || 0;
      const active = Math.max(0, blood + wound);
      visualElement.style.opacity = active > 0 ? String(Math.min(0.9, 0.13 + active * 0.017)) : '0';
      window.EffectBuffBar?.refresh?.(); // Shared effect icons, not a second HUD lifecycle.
      if (active > 0) refreshHandle = setTimeout(tick, 700); // Timer only runs while the player hallucinates wounds/blood.
      else refreshHandle = null;
    };
    tick();
  }

  ensureBuffProvider(); // Works in standalone previews whose HUD owner loaded earlier, too.
  if (!registered && typeof document !== 'undefined') {
    document.addEventListener?.('DOMContentLoaded', ensureBuffProvider, { once: true }); // Installs after the shared buff-bar script even when saved illusions exist before a new Fey strike.
  }
  window.addEventListener?.('hobunjiPlayerReady', ensureBuffProvider); // Refresh provider ownership as the authoritative character changes after loading a save.
  window.FeyIllusions = Object.freeze({
    EFFECTS, apply, potency, playerSymptoms,
    ensureBuffProvider,
    debugSnapshot: () => ({ registered, lastEffect, visible: !!visualElement && visualElement.style.opacity !== '0' }),
  });
})();
