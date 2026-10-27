(() => {
  'use strict';

  if (Number(window.TemplePrayerRestBlessings?.version) >= 3) return;

  const VERSION = 3;
  const SAVE_FIELD = 'templePrayerRestBlessings'; // Stored on the active character so prayer/rest timers survive reloads with that character.
  const PRAYER_DURATION_HOURS = 7 * 24; // Used by all three temple prayers: one full in-game week.
  const WELL_RESTED_DURATION_HOURS = 16; // Used after a completed farmhouse-bed Sleep passage.
  const ACTION_ID = 'temple_pray'; // Used by Action 3 while the player is seated in a temple pew on Anan.
  const ACTION_BUTTON_ID = 'btnAction3'; // Leaves Action 1 Stand and Action 2 Wait untouched while seated.
  const OWNED_BED_SLEEP_PENDING_KEY = '__hobunjiOwnedBedSleepPending'; // One-shot token armed only by the player's real bed Sleep interaction.
  const DOT_AFFLICTIONS = new Set(['bleedingHealth', 'poisonedHealth', 'burningHealth', 'kindlingHealth', 'corrodedHealth']); // Narshangetic resistance applies only to Health DoT buildup, not every Damage-family affliction.
  const CHANGE_SUMMARY = 'Temple prayer recognizes live benches, restores blessings after character selection, and supports controller Back and Escape; copied diagnostics show eligibility and saved character.'; // Shown in mobile-readable diagnostics.

  const PRAYERS = Object.freeze({
    naoine: Object.freeze({ id: 'naoine', name: "Nao'ine Prayer", icon: '🌿', healingMultiplier: 1.20, skillStacks: Object.freeze({ foraging: 3, farming: 3 }), description: '+20% healing; +3 Foraging and Farming.' }),
    krurenic: Object.freeze({ id: 'krurenic', name: 'Krurenic Prayer', icon: '🛡️', damageTakenMultiplier: 0.85, skillStacks: Object.freeze({ mining: 3 }), description: '15% damage resistance; +3 Mining.' }),
    narshangetic: Object.freeze({ id: 'narshangetic', name: 'Narshangetic Prayer', icon: '🐟', afflictionRecoveryMultiplier: 1.35, dotApplicationMultiplier: 0.70, skillStacks: Object.freeze({ fishing: 3 }), description: '+35% affliction recovery; 30% less DoT buildup; +3 Fishing.' }),
  });

  let state = { prayer: null, wellRested: null }; // Current character-scoped blessing state read by every runtime modifier below.
  let stateCharacterId = null; // Hydrates late-selected characters once and prevents saving a previous character's blessings into another record.
  let actionSnapshot = null; // Original Action 3 presentation restored when the Pray prompt is no longer valid.
  let actionInjected = false; // Prevents repeated snapshots while the prompt sync loop is active.
  let lastPromptEligible = false; // Exposed in diagnostics to make mobile day/seat failures visible.
  let lastPrayerWeekday = null; // Exposed in diagnostics to show the calendar weekday used for prayer eligibility.
  let lastRestSource = null; // Exposed in diagnostics to prove Well Rested came from the player-bed token.
  let lastError = null; // Captures nonfatal hook/storage errors for the in-game debug report.
  let resourceHooksInstalled = false; // Ensures ResourceSystem wrappers install once after late game boot.
  let cookingHookInstalled = false; // Ensures food/skill stack wrapping installs once.
  let alchemyHooksInstalled = false; // Ensures Well Rested potion-strength wrapping installs once.
  let hudProviderInstalled = false; // Ensures EffectBuffBar provider registration installs once.
  let syncTimer = null; // Low-frequency prompt/hook/expiry sync; no frame-level polling is needed.

  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, finite(value)));

  function currentGameHour() {
    if (!window.CalendarSystem || window.CalendarSystem.isInitialized?.() === false) return NaN; // Parser-time loading precedes game.js calendar injection; preserve saved timers until the clock is ready.
    const snap = window.CalendarSystem?.timeDebugSnapshot?.(); // Uses the calendar's monotonic raw day/time so timers survive month/season boundaries.
    const rawDay = finite(snap?.rawDay, NaN);
    const rawTime01 = finite(snap?.time01 ?? snap?.rawTime01, NaN);
    if (Number.isFinite(rawDay) && Number.isFinite(rawTime01)) return rawDay * 24 + rawTime01 * 24;
    const hour = finite(window.CalendarSystem?.getHour?.(), NaN);
    return Number.isFinite(hour) ? hour : 0;
  }

  function activeCharacterRecord() {
    try {
      const characterId = window.__hobunjiPlayerProfile?.characterId; // Matches CharacterMetaSave's authoritative current-character lookup.
      if (!characterId) return null;
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      return (meta?.characters || []).find(character => character.id === characterId) || null;
    } catch (error) {
      lastError = `read save: ${String(error?.message || error)}`;
      return null;
    }
  }

  function normalizedSavedState(raw) {
    const next = raw && typeof raw === 'object' ? raw : {};
    return {
      prayer: next.prayer && PRAYERS[next.prayer.id] ? { id: next.prayer.id, startedAtGameHour: finite(next.prayer.startedAtGameHour), expiresAtGameHour: finite(next.prayer.expiresAtGameHour) } : null,
      wellRested: next.wellRested ? { startedAtGameHour: finite(next.wellRested.startedAtGameHour), expiresAtGameHour: finite(next.wellRested.expiresAtGameHour) } : null,
    };
  }

  function loadState() {
    stateCharacterId = window.__hobunjiPlayerProfile?.characterId || null;
    state = normalizedSavedState(activeCharacterRecord()?.[SAVE_FIELD]);
    return state;
  }

  function persistState() {
    if (!stateCharacterId || stateCharacterId !== window.__hobunjiPlayerProfile?.characterId) return false;
    const snapshot = JSON.parse(JSON.stringify(state)); // Keeps the save helper isolated from later in-memory mutation.
    const wrote = window.CharacterMetaSave?.update?.(character => { character[SAVE_FIELD] = snapshot; });
    if (wrote) return true;
    try {
      const characterId = window.__hobunjiPlayerProfile?.characterId; // Fallback for test/minimal boots where CharacterMetaSave has not loaded.
      const meta = JSON.parse(localStorage.getItem('hobunjiSaveMeta') || 'null');
      const character = (meta?.characters || []).find(entry => entry.id === characterId);
      if (!character) return false;
      character[SAVE_FIELD] = snapshot;
      localStorage.setItem('hobunjiSaveMeta', JSON.stringify(meta));
      return true;
    } catch (error) {
      lastError = `write save: ${String(error?.message || error)}`;
      return false;
    }
  }

  function expireState(persist = true) {
    if (stateCharacterId !== (window.__hobunjiPlayerProfile?.characterId || null)) loadState();
    const now = currentGameHour(); // One read keeps prayer/rest expiry comparisons internally consistent for this sync.
    if (!Number.isFinite(now)) return false;
    let changed = false;
    if (state.prayer && !(state.prayer.expiresAtGameHour > now)) { state.prayer = null; changed = true; }
    if (state.wellRested && !(state.wellRested.expiresAtGameHour > now)) { state.wellRested = null; changed = true; }
    if (changed && persist) persistState();
    if (changed) window.EffectBuffBar?.refresh?.(true);
    return changed;
  }

  function activePrayer() {
    expireState();
    return state.prayer ? PRAYERS[state.prayer.id] || null : null;
  }

  function isWellRested() {
    expireState();
    return !!state.wellRested;
  }

  function activeTemplePrayerDay() {
    if (window.__hobunjiFurnitureDebug?.getCurrentArea?.() !== 'map_i_temple') return null;
    const weekday = window.CalendarSystem?.currentWeekdayName?.(); // Public weekday reads use the civil-midnight bridge, matching the Anan Spirit Communion layout from 00:00 onward.
    return weekday === 'Anan' ? { id: 'anan', label: weekday } : null;
  }

  function seatedInTemplePew() {
    const sit = window.__hobunjiFurnitureDebug?.sitState; // Shared player seat state includes the exact furniture key and sit phase.
    return !!sit && sit.phase !== 'out' && (sit.furnitureKey === 'bench' || sit.furnitureKey === 'benchFurniture') && window.__hobunjiFurnitureDebug?.getCurrentArea?.() === 'map_i_temple';
  }

  function promptEligible() {
    const prayerDay = activeTemplePrayerDay(); // Prayer is intentionally day-gated rather than service-window-gated so every temple bench works throughout Anan.
    lastPrayerWeekday = window.CalendarSystem?.currentWeekdayName?.() || null;
    lastPromptEligible = !!prayerDay && seatedInTemplePew();
    return lastPromptEligible;
  }

  function snapshotButton(button) {
    return {
      action: button.dataset.action || '', hidden: button.classList.contains('abt-hidden'),
      label: button.querySelector('.abt-label')?.textContent || '', title: button.title || '',
    };
  }

  function injectPrayAction() {
    const button = document.getElementById(ACTION_BUTTON_ID);
    if (!button) return false;
    if (button.dataset.action === ACTION_ID && !button.classList.contains('abt-hidden')) return true;
    if (!actionInjected) { actionSnapshot = snapshotButton(button); actionInjected = true; }
    button.dataset.action = ACTION_ID;
    button.dataset.templePrayerInjected = '1';
    button.classList.remove('abt-hidden', 'blocked');
    const label = button.querySelector('.abt-label');
    if (label) label.textContent = 'Pray';
    else button.textContent = 'Pray';
    button.title = 'Pray at the temple on Anan';
    return true;
  }

  function restorePrayAction() {
    const button = document.getElementById(ACTION_BUTTON_ID);
    if (!actionInjected || !button) return false;
    delete button.dataset.templePrayerInjected;
    if (actionSnapshot) {
      button.dataset.action = actionSnapshot.action;
      const label = button.querySelector('.abt-label');
      if (label) label.textContent = actionSnapshot.label;
      button.title = actionSnapshot.title;
      button.classList.toggle('abt-hidden', !!actionSnapshot.hidden);
    }
    actionSnapshot = null;
    actionInjected = false;
    return true;
  }

  function ensureStyles() {
    if (document.getElementById('templePrayerMenuStyles')) return;
    const style = document.createElement('style'); // Isolated modal styling; controller navigation only depends on data-ctrl-panel/buttons below.
    style.id = 'templePrayerMenuStyles';
    style.textContent = `
      .temple-prayer-backdrop{position:fixed;inset:0;z-index:2147481300;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.66);padding:18px;box-sizing:border-box}
      .temple-prayer-backdrop.open{display:flex}
      .temple-prayer-panel{width:min(620px,94vw);max-height:90vh;overflow:auto;background:#181711;border:1px solid #8f8359;border-radius:14px;padding:18px;box-shadow:0 18px 60px #000b;color:#f1ead6}
      .temple-prayer-panel h2{margin:0 0 6px;font-size:1.35rem}.temple-prayer-panel p{margin:0 0 14px;color:#cfc6ac}
      .temple-prayer-options{display:grid;gap:10px}.temple-prayer-choice,.temple-prayer-cancel{font:inherit;text-align:left;border:1px solid #766b49;border-radius:10px;background:#28251a;color:#f5eedb;padding:12px;cursor:pointer}
      .temple-prayer-choice:focus,.temple-prayer-cancel:focus{outline:3px solid #ead98b;outline-offset:2px}.temple-prayer-choice strong{display:block;font-size:1.05rem;margin-bottom:3px}.temple-prayer-choice span{display:block;color:#cfc6ac;font-size:.92rem}
      .temple-prayer-cancel{margin-top:12px;text-align:center}
    `;
    document.head.appendChild(style);
  }

  function ensureMenu() {
    let backdrop = document.getElementById('templePrayerBackdrop');
    if (backdrop) return backdrop;
    ensureStyles();
    backdrop = document.createElement('div'); // Uses the standard controller-visible panel contract already used by festival modals.
    backdrop.id = 'templePrayerBackdrop';
    backdrop.className = 'temple-prayer-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    const panel = document.createElement('section');
    panel.className = 'temple-prayer-panel';
    panel.dataset.ctrlPanel = 'templePrayerMenu';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'templePrayerTitle');
    panel.innerHTML = `<h2 id="templePrayerTitle">Choose a Prayer</h2><p>The blessing lasts one in-game week. Choosing another prayer replaces the current prayer blessing.</p><div class="temple-prayer-options"></div><button class="temple-prayer-cancel" type="button" data-ctrl-cancel>Cancel</button>`;
    const options = panel.querySelector('.temple-prayer-options');
    for (const prayer of Object.values(PRAYERS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'temple-prayer-choice';
      button.dataset.prayerId = prayer.id;
      button.innerHTML = `<strong>${prayer.icon} ${prayer.name}</strong><span>${prayer.description}</span>`;
      button.addEventListener('click', () => choosePrayer(prayer.id));
      options.appendChild(button);
    }
    panel.querySelector('.temple-prayer-cancel').addEventListener('click', closeMenu);
    backdrop.addEventListener('click', event => { if (event.target === backdrop) closeMenu(); });
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function openMenu() {
    if (!promptEligible()) return false;
    const backdrop = ensureMenu();
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    backdrop.querySelector('.temple-prayer-choice')?.focus?.();
    return true;
  }

  function closeMenu() {
    const backdrop = document.getElementById('templePrayerBackdrop');
    if (!backdrop) return;
    backdrop.classList.remove('open');
    backdrop.setAttribute('aria-hidden', 'true');
    document.getElementById(ACTION_BUTTON_ID)?.focus?.();
  }

  function choosePrayer(id) {
    const prayer = PRAYERS[id];
    if (!prayer || !promptEligible()) return false;
    expireState();
    const now = currentGameHour(); // Prayer replacement/refresh always starts a fresh seven-day timer.
    if (!Number.isFinite(now)) return false;
    state.prayer = { id: prayer.id, startedAtGameHour: now, expiresAtGameHour: now + PRAYER_DURATION_HOURS };
    persistState();
    window.EffectBuffBar?.refresh?.(true);
    window.InventoryCharacterEffects?.refresh?.();
    window.__farmLog?.(`[temple prayer] ${prayer.name} active for ${PRAYER_DURATION_HOURS}h`, 'info');
    closeMenu();
    return true;
  }

  function grantWellRested() {
    expireState();
    const now = currentGameHour(); // Every qualifying player-bed Sleep refreshes the full 16-hour timer rather than stacking copies.
    if (!Number.isFinite(now)) return false;
    state.wellRested = { startedAtGameHour: now, expiresAtGameHour: now + WELL_RESTED_DURATION_HOURS };
    persistState();
    window.EffectBuffBar?.refresh?.(true);
    window.InventoryCharacterEffects?.refresh?.();
    window.__farmLog?.('[rest] Well Rested active for 16h: +8% speed, +30% Stamina recovery, +1/3 food/potion buff strength.', 'info');
    return true;
  }

  function skillStackBonus(skillKey) {
    return Math.max(0, finite(activePrayer()?.skillStacks?.[skillKey], 0));
  }

  function foodBonusStacks(baseStacks) {
    const base = Math.max(0, Math.floor(finite(baseStacks, 0))); // Literal +one-third stack rule requested for food, rounded down.
    return isWellRested() ? Math.floor(base / 3) : 0;
  }

  function movementSpeedMultiplier() { return isWellRested() ? 1.08 : 1; }
  function potionEffectScale() { return isWellRested() ? (4 / 3) : 1; }

  function strengthenPotionMultiplier(value) {
    const raw = finite(value, 1);
    if (!isWellRested() || raw === 1) return raw;
    const scale = potionEffectScale(); // Potions store continuous magnitudes rather than discrete stacks; scale their distance from neutral by +1/3.
    return raw > 1 ? 1 + (raw - 1) * scale : Math.max(0, 1 - (1 - raw) * scale);
  }

  function isPlayer(entity) {
    return !!entity && entity === window.Combat?.deps?.player; // ResourceSystem is shared with NPCs/hostiles; blessings must affect only the player.
  }

  function installResourceHooks() {
    const rs = window.ResourceSystem;
    if (resourceHooksInstalled || !rs?.tick || !rs?.applyDamage || !rs?.addAffliction) return false;
    const originalTick = rs.tick.bind(rs); // Wrapped to apply rest regen and extra natural affliction recovery without editing the central resource engine.
    const originalDamage = rs.applyDamage.bind(rs); // Wrapped for Krurenic direct-damage resistance.
    const originalHealthAfflictionDamage = rs.applyHealthAfflictionDamage?.bind(rs); // Wrapped for Krurenic DoT Health damage resistance.
    const originalHealing = rs.applyHealthRecovery?.bind(rs); // Wrapped for Nao'ine healing from item/ability sources.
    const originalAddAffliction = rs.addAffliction.bind(rs); // Wrapped for Narshangetic Health-DoT buildup resistance.

    rs.applyDamage = function templeBlessingApplyDamage(entity, amount, ...args) {
      const prayer = activePrayer();
      const adjusted = isPlayer(entity) && prayer?.damageTakenMultiplier ? finite(amount) * prayer.damageTakenMultiplier : amount;
      return originalDamage(entity, adjusted, ...args);
    };
    if (originalHealthAfflictionDamage) rs.applyHealthAfflictionDamage = function templeBlessingHealthAfflictionDamage(entity, amount, ...args) {
      const prayer = activePrayer();
      const adjusted = isPlayer(entity) && prayer?.damageTakenMultiplier ? finite(amount) * prayer.damageTakenMultiplier : amount;
      return originalHealthAfflictionDamage(entity, adjusted, ...args);
    };
    if (originalHealing) rs.applyHealthRecovery = function templeBlessingHealthRecovery(entity, amount, ...args) {
      const prayer = activePrayer();
      const adjusted = isPlayer(entity) && prayer?.healingMultiplier ? finite(amount) * prayer.healingMultiplier : amount;
      return originalHealing(entity, adjusted, ...args);
    };
    rs.addAffliction = function templeBlessingAddAffliction(entity, id, amount, ...args) {
      const prayer = activePrayer();
      const adjusted = isPlayer(entity) && prayer?.dotApplicationMultiplier && DOT_AFFLICTIONS.has(id)
        ? finite(amount) * prayer.dotApplicationMultiplier : amount;
      return originalAddAffliction(entity, id, adjusted, ...args);
    };
    rs.tick = function templeBlessingTick(entity, dt, options = {}) {
      const player = isPlayer(entity);
      const prayer = player ? activePrayer() : null;
      const recoverBefore = new Map(); // Used to measure only recovery the ResourceSystem actually performed this tick before adding +35% more.
      if (player && prayer?.afflictionRecoveryMultiplier > 1 && rs.AFFLICTIONS && rs.getAffliction) {
        for (const [id, def] of Object.entries(rs.AFFLICTIONS)) if (def?.recovers === true) recoverBefore.set(id, finite(rs.getAffliction(entity, id), 0));
      }
      let nextOptions = options;
      if (player && (isWellRested() || prayer?.healingMultiplier)) {
        nextOptions = { ...options };
        if (isWellRested() && Number.isFinite(Number(nextOptions.staminaRegenPerSec))) nextOptions.staminaRegenPerSec = Number(nextOptions.staminaRegenPerSec) * 1.30;
        if (prayer?.healingMultiplier && Number.isFinite(Number(nextOptions.healthRegenPerSec))) nextOptions.healthRegenPerSec = Number(nextOptions.healthRegenPerSec) * prayer.healingMultiplier;
      }
      const result = originalTick(entity, dt, nextOptions);
      if (recoverBefore.size && rs.removeAffliction && prayer?.afflictionRecoveryMultiplier > 1) {
        const extraFraction = prayer.afflictionRecoveryMultiplier - 1;
        for (const [id, before] of recoverBefore) {
          const after = finite(rs.getAffliction(entity, id), 0);
          const recovered = Math.max(0, before - after);
          if (recovered > 0) rs.removeAffliction(entity, id, recovered * extraFraction);
        }
      }
      return result;
    };
    resourceHooksInstalled = true;
    return true;
  }

  function installCookingHook() {
    const cooking = window.CookingSystem;
    if (cookingHookInstalled || !cooking?.getFoodEffectStacks) return false;
    const original = cooking.getFoodEffectStacks.bind(cooking); // SkillSystem calls this dynamically, so prayer skill levels reuse the existing food-stack pathway.
    cooking.getFoodEffectStacks = function templeBlessingFoodStacks(effectKey) {
      const base = Math.max(0, finite(original(effectKey), 0));
      return base + foodBonusStacks(base) + skillStackBonus(effectKey);
    };
    cookingHookInstalled = true;
    return true;
  }

  function installAlchemyHooks() {
    const alchemy = window.AlchemySystem;
    if (alchemyHooksInstalled || !alchemy) return false;
    const multiplierGetters = [
      'getOutgoingDamageMultiplier', 'getMovementSpeedMultiplier', 'getSpeedMul', 'getFootingDamageMultiplier',
      'getAttackSpeedMultiplier', 'getStaminaSpendMultiplier', 'getStaminaRegenMultiplier', 'getHealthRegenMultiplier',
      'getIncomingDamageAfflictionMultiplier', 'getPositiveFavorMultiplier', 'getPerceptionMultiplier',
    ]; // Public potion-buff multipliers consumed throughout gameplay; Well Rested strengthens their distance from neutral by one third.
    let wrapped = 0;
    for (const name of multiplierGetters) {
      if (typeof alchemy[name] !== 'function' || alchemy[name].__wellRestedWrapped) continue;
      const original = alchemy[name].bind(alchemy);
      const wrapper = function wellRestedPotionMultiplier(...args) { return strengthenPotionMultiplier(original(...args)); };
      wrapper.__wellRestedWrapped = true;
      alchemy[name] = wrapper;
      wrapped++;
    }
    alchemyHooksInstalled = wrapped > 0;
    return alchemyHooksInstalled;
  }

  function installHudProvider() {
    if (hudProviderInstalled || !window.EffectBuffBar?.registerProvider) return false;
    window.EffectBuffBar.registerProvider('temple-prayer-rest', () => {
      expireState();
      const now = currentGameHour();
      const entries = [];
      if (state.prayer) {
        const prayer = PRAYERS[state.prayer.id];
        if (prayer) entries.push({ id: `temple-prayer-${prayer.id}`, icon: prayer.icon, label: prayer.name, sourceLabel: 'Temple Prayer', durationS: PRAYER_DURATION_HOURS * 3600, remainingS: (state.prayer.expiresAtGameHour - now) * 3600 });
      }
      if (state.wellRested) entries.push({ id: 'well-rested', icon: '🛏️', label: 'Well Rested', sourceLabel: 'Sleep', durationS: WELL_RESTED_DURATION_HOURS * 3600, remainingS: (state.wellRested.expiresAtGameHour - now) * 3600 });
      return entries;
    });
    hudProviderInstalled = true;
    return true;
  }

  function formatRemaining(hours) {
    const safe = Math.max(0, finite(hours, 0));
    if (safe >= 24) return `${Math.floor(safe / 24)}d ${Math.floor(safe % 24)}h`;
    return `${Math.max(0, Math.ceil(safe))}h`;
  }

  function getPrayerAction() {
    return promptEligible() ? { icon: '🙏', label: 'Pray', action: ACTION_ID, inputAction: 'action3', style: 'secondary', allowed: true, worldInteraction: true } : null;
  }

  function syncPrompt() {
    if (promptEligible()) injectPrayAction();
    else restorePrayAction();
  }

  function onActionClick(event) {
    const button = event.target?.closest?.(`#${ACTION_BUTTON_ID}`);
    if (!button || button.dataset.action !== ACTION_ID) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openMenu();
  }

  function onActionKey(event) {
    if (document.getElementById('templePrayerBackdrop')?.classList.contains('open')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeMenu();
      }
      return;
    }
    if (event.repeat || !promptEligible()) return;
    const button = document.getElementById(ACTION_BUTTON_ID);
    if (!button || button.dataset.action !== ACTION_ID) return;
    const badge = String(button.querySelector('.abt-key')?.textContent || '').replace(/[\[\]\s]/g, '').toUpperCase(); // Reuses whichever desktop key the action bar currently displays for Action 3.
    const code = ({ E: 'KeyE', Q: 'KeyQ', F3: 'F3', F4: 'F4' })[badge];
    if (!code || event.code !== code) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openMenu();
  }

  function consumeOwnedBedSleepToken() {
    const token = window[OWNED_BED_SLEEP_PENDING_KEY]; // Token exists only when the visible player-bed Sleep interaction was activated.
    window[OWNED_BED_SLEEP_PENDING_KEY] = null;
    if (!token || token.source !== 'player-bed') return false;
    lastRestSource = token.source;
    return true;
  }

  function onTimePassage(event) {
    if (event?.detail?.kind !== 'sleep') return;
    if (!consumeOwnedBedSleepToken()) return; // Debug or other generic Sleep passages must not grant Well Rested.
    if (event.detail.hours === 0) return; // Cancelling before the first hour consumes the token without granting sleep benefits.
    grantWellRested();
  }

  function installDebugHook() {
    if (!window.__farmDebugTools) return;
    window.__farmDebugTools.prayerRestSnapshot = debugSnapshot; // Mobile-copyable state alongside the existing communityScheduleSnapshot helper.
  }

  function debugSnapshot() {
    expireState();
    promptEligible();
    const area = window.__hobunjiFurnitureDebug?.getCurrentArea?.() || null; // Reports the actual map instead of hiding an area mismatch behind a false eligibility flag.
    const seat = window.__hobunjiFurnitureDebug?.sitState; // Captures the live furniture identity and seating phase for mobile diagnosis.
    const button = document.getElementById(ACTION_BUTTON_ID); // Distinguishes an eligible prayer from a missing or hidden action-bar slot.
    const unavailableReason = !window.CalendarSystem || window.CalendarSystem.isInitialized?.() === false ? 'Calendar is not ready.'
      : area !== 'map_i_temple' ? 'Enter the Life Temple.'
      : lastPrayerWeekday !== 'Anan' ? `Weekly prayer is available on Anan; today is ${lastPrayerWeekday || 'unknown'}.`
      : !seatedInTemplePew() ? 'Sit on a temple bench.' : null; // Reports the first blocking condition without changing prayer eligibility.
    return {
      installed: true, version: VERSION, latestChange: CHANGE_SUMMARY,
      characterId: stateCharacterId,
      gameHour: currentGameHour(), prayerWeekday: lastPrayerWeekday, promptEligible: lastPromptEligible,
      seated: seatedInTemplePew(), actionInjected,
      area, seat: seat ? { furnitureKey: seat.furnitureKey, phase: seat.phase, col: seat.col, row: seat.row, seatIndex: seat.seatIndex } : null,
      unavailableReason,
      actionButton: button ? { action: button.dataset.action || null, hidden: button.classList.contains('abt-hidden') } : null,
      prayer: state.prayer ? { ...state.prayer, name: PRAYERS[state.prayer.id]?.name || state.prayer.id, remainingHours: Math.max(0, state.prayer.expiresAtGameHour - currentGameHour()) } : null,
      wellRested: state.wellRested ? { ...state.wellRested, remainingHours: Math.max(0, state.wellRested.expiresAtGameHour - currentGameHour()) } : null,
      ownedBedSleepPending: !!window[OWNED_BED_SLEEP_PENDING_KEY], lastRestSource,
      hooks: { resourceHooksInstalled, cookingHookInstalled, alchemyHooksInstalled, hudProviderInstalled },
      currentBonuses: {
        healingMultiplier: activePrayer()?.healingMultiplier || 1,
        damageTakenMultiplier: activePrayer()?.damageTakenMultiplier || 1,
        afflictionRecoveryMultiplier: activePrayer()?.afflictionRecoveryMultiplier || 1,
        dotApplicationMultiplier: activePrayer()?.dotApplicationMultiplier || 1,
        moveSpeedMultiplier: movementSpeedMultiplier(), staminaRecoveryMultiplier: isWellRested() ? 1.30 : 1,
        potionEffectScale: potionEffectScale(),
      },
      lastError,
    };
  }

  function sync() {
    try {
      expireState();
      installResourceHooks();
      installCookingHook();
      installAlchemyHooks();
      installHudProvider();
      installDebugHook();
      syncPrompt();
    } catch (error) {
      lastError = String(error?.stack || error?.message || error);
      window.__farmLog?.(`[temple prayer] sync failed: ${lastError}`, 'warn');
    }
  }

  loadState();
  document.addEventListener('click', onActionClick, true);
  window.addEventListener('keydown', onActionKey, true);
  window.addEventListener('hobunji-time-passage', onTimePassage);
  window.addEventListener('beforeunload', persistState);
  sync();
  syncTimer = window.setInterval(sync, 250);

  window.TemplePrayerRestBlessings = Object.freeze({
    version: VERSION,
    PRAYERS,
    activePrayer,
    isWellRested,
    skillStackBonus,
    foodBonusStacks,
    movementSpeedMultiplier,
    potionEffectScale,
    debugSnapshot,
    openMenu,
    getPrayerAction,
    _test: Object.freeze({ choosePrayer, grantWellRested, activeTemplePrayerDay, activeTempleService: activeTemplePrayerDay, seatedInTemplePew, promptEligible, expireState, strengthenPotionMultiplier, consumeOwnedBedSleepToken, sync }),
  });
})();
