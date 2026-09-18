// Banubu's sequential three-fish-pie questline.
(() => {
  'use strict';

  const global = window; // Used as the browser runtime and export target.
  const CONTENT = () => global.BanubuQuestContent; // Used to resolve editable quest content after all scripts load.
  const QUEST_ID = 'banubu_fish_pies'; // Used as the world-member questProgress key for the chain.
  const INSTALL_INTERVAL_MS = 250; // Used by the bounded dependency installer while game modules initialize.
  const INSTALL_TIMEOUT_MS = 20000; // Used to stop active polling once late global assignment hooks are sufficient.

  let installed = false; // Used to make runtime integration idempotent.
  let installTimer = null; // Used to stop the dependency poll after success/timeout.
  let installStartedAt = 0; // Used to bound dependency polling on editor/partial pages.
  const debugState = { lastAction: null, lastTarget: null, lastTurnIn: null, lastError: null }; // Used by in-game diagnostics and automated tests.

  function playerData() { // Used as the live world-member state mirror for quest progression and cooking persistence.
    return global.__hobunjiPlayerProfile || null;
  }

  function readMeta() { // Used to persist quest/cooking data without depending on private game.js closure functions.
    try { return JSON.parse(global.localStorage?.getItem('hobunjiSaveMeta') || 'null'); } catch (_) { return null; }
  }

  function persistMemberState() { // Used after every quest transition/recipe unlock so browser reloads cannot lose progress.
    const profile = playerData(); // Used to identify the active member and copy live quest state.
    const meta = readMeta(); // Used as the persistent save record to update.
    if (!profile?.characterId || !profile?.worldId || !meta) return false;
    const world = meta.worlds?.find(entry => entry?.id === profile.worldId); // Used to locate the active world.
    const member = world?.members?.[profile.characterId]; // Used to locate this character's world-scoped member state.
    if (!member) return false;
    member.questProgress = JSON.parse(JSON.stringify(profile.questProgress || {}));
    if (global.CookingSystem?.serialize) {
      profile.cookingState = global.CookingSystem.serialize();
      member.cookingState = JSON.parse(JSON.stringify(profile.cookingState));
    }
    try { global.localStorage?.setItem('hobunjiSaveMeta', JSON.stringify(meta)); return true; } catch (_) { return false; }
  }

  function ensureQuestState() { // Used by dialogue routing/actions to lazily migrate old saves into the Banubu chain.
    const profile = playerData(); // Used as the live holder of world-member questProgress.
    if (!profile) return null;
    if (!profile.questProgress || typeof profile.questProgress !== 'object') profile.questProgress = {};
    const current = profile.questProgress[QUEST_ID]; // Used to preserve an existing stage/target instead of rerolling it.
    if (current && typeof current === 'object') return current;
    const created = { status: 'intro', stage: 0, target: null }; // Used as the initial first-conversation state.
    profile.questProgress[QUEST_ID] = created;
    persistMemberState();
    return created;
  }

  function treesForBanubu(record) { // Used to read editor-exported trees first and built-in fallback trees second.
    const authored = (record?.dialogueTrees || []).filter(tree => tree?.banubuQuest); // Used as the runtime-authoritative quest tree set.
    return authored.length ? authored : (CONTENT()?.dialogueTrees || []);
  }

  function stageDefinition(record, stage) { // Used to get difficulty/reward metadata from the editable offer tree for one stage.
    const offer = treesForBanubu(record).find(tree => Number(tree?.banubuQuest?.stage) === Number(stage) && tree?.banubuQuest?.phase === 'offer'); // Used as the canonical stage authoring record.
    const fallback = CONTENT()?.stageDefaults?.find(entry => Number(entry.stage) === Number(stage)); // Used only if an exported tree omitted newer metadata.
    const meta = offer?.banubuQuest || {}; // Used to combine editor metadata with fallback defaults.
    return {
      stage: Number(stage),
      buffCount: Math.max(1, Math.min(3, Number(meta.buffCount ?? fallback?.buffCount) || 1)),
      reward: { ...(fallback?.reward || {}), ...(meta.reward || {}) },
    };
  }

  function ingredientEffectKeys(definition) { // Used by target generation to mirror cooking-system effect-key semantics independent of star quantity.
    const explicit = definition?.foodEffects && typeof definition.foodEffects === 'object' ? Object.keys(definition.foodEffects).filter(key => Number(definition.foodEffects[key]) > 0) : []; // Used when an ingredient has authored multi-effect food data.
    if (explicit.length) return explicit.sort();
    return definition?.cookingPrimaryEffect ? [String(definition.cookingPrimaryEffect)] : [];
  }

  function effectSetForFishKeys(fishKeys) { // Used both to prove a generated target is craftable and to expose its exact requested buff combination.
    const ingredients = global.CookingSystem?.listIngredientDefinitions?.('fish') || []; // Used as the current live fish/effect catalog.
    const byKey = new Map(ingredients.map(entry => [entry.key, entry.definition])); // Used to resolve each concrete three-fish solution.
    const effects = new Set(); // Used to deduplicate buffs across the three fish just like the cooked meal effect object does.
    for (const key of fishKeys || []) { // Used to union every effect produced by the concrete solution.
      const definition = byKey.get(key); // Used to inspect this fish's actual cooking effects.
      for (const effect of ingredientEffectKeys(definition)) effects.add(effect);
    }
    return [...effects].sort();
  }

  function allFeasibleTargets(desiredCount) { // Used to enumerate only buff sets for which a concrete three-fish recipe exists.
    const fishes = global.CookingSystem?.listIngredientDefinitions?.('fish') || []; // Used as the complete live fish ingredient catalog, not current inventory.
    const candidates = fishes.filter(entry => ingredientEffectKeys(entry.definition).length); // Used to omit fish lacking any cooking buff.
    const bySignature = new Map(); // Used to dedupe many fish triples that produce the same exact buff combination.
    for (let a = 0; a < candidates.length; a++) { // Used as the first recipe slot index.
      for (let b = a; b < candidates.length; b++) { // Used as the second slot index while allowing repeated species.
        for (let c = b; c < candidates.length; c++) { // Used as the third slot index while allowing repeated species.
          const keys = [candidates[a].key, candidates[b].key, candidates[c].key]; // Used as a concrete proof/diagnostic recipe for this target.
          const effects = effectSetForFishKeys(keys); // Used as the exact buff-key set the cooked pie will contain.
          if (!effects.length) continue;
          const signature = effects.join('|'); // Used to keep one concrete solution per exact effect combination.
          if (!bySignature.has(signature)) bySignature.set(signature, { requiredEffects: effects, solutionFishKeys: keys });
        }
      }
    }
    const all = [...bySignature.values()]; // Used to filter toward the author-requested buff-count difficulty.
    const exact = all.filter(target => target.requiredEffects.length === desiredCount); // Used when this fish catalog can satisfy the requested count exactly.
    if (exact.length) return exact;
    if (!all.length) return [];
    const closestDistance = Math.min(...all.map(target => Math.abs(target.requiredEffects.length - desiredCount))); // Used to remain feasible if a future fish catalog lacks an exact cardinality.
    return all.filter(target => Math.abs(target.requiredEffects.length - desiredCount) === closestDistance);
  }

  function rollTarget(record, stage) { // Used once per stage to pick a random but demonstrably craftable buff combination.
    const definition = stageDefinition(record, stage); // Used to read the editor-authored requested buff count.
    const feasible = allFeasibleTargets(definition.buffCount); // Used to constrain randomness to real three-fish outcomes.
    if (!feasible.length) return null;
    const index = Math.floor(Math.random() * feasible.length); // Used to select one feasible effect signature uniformly for this stage.
    const picked = feasible[index]; // Used as the persisted target and its hidden proof recipe.
    const target = { requiredEffects: [...picked.requiredEffects], solutionFishKeys: [...picked.solutionFishKeys] }; // Used to prevent later mutation of enumerator data.
    debugState.lastTarget = { stage, desiredBuffCount: definition.buffCount, ...target };
    return target;
  }

  function ensureTarget(record, state) { // Used by offer/active/ready dialogue so a stage's randomized request stays stable after first roll.
    if (state?.target?.requiredEffects?.length) return state.target;
    const target = rollTarget(record, state?.stage); // Used to generate a first-time target from the current real fish catalog.
    if (!target) return null;
    state.target = target;
    persistMemberState();
    return target;
  }

  function sameEffectSet(left, right) { // Used to require the pie's exact requested combination rather than accepting unrelated extra buffs.
    const a = [...new Set(left || [])].sort(); // Used as the normalized requested buff set.
    const b = [...new Set(right || [])].sort(); // Used as the normalized cooked-pie buff set.
    return a.length === b.length && a.every((entry, index) => entry === b[index]);
  }

  function matchingPie(state) { // Used to determine dialogue readiness and turn in exactly one qualifying cooked item.
    const required = state?.target?.requiredEffects || []; // Used as the active quest's exact buff-key requirement.
    if (!required.length) return null;
    const meals = global.CookingSystem?.listCookedInventory?.() || []; // Used to inspect real live cooked-food stacks.
    return meals.find(entry => entry.definition?.recipeId === CONTENT()?.RECIPE_ID
      && sameEffectSet(Object.keys(entry.definition?.foodEffects || {}).filter(key => Number(entry.definition.foodEffects[key]) > 0), required)) || null;
  }

  function effectLabel(effectKey) { // Used to turn saved machine effect keys into readable dialogue tokens.
    return global.CookingSystem?.effectLabel?.(effectKey) || String(effectKey).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, character => character.toUpperCase());
  }

  function tokenValues(record, state) { // Used by the tree provider to resolve quest-only tokens without adding Banubu special cases to core dialogue text.
    const definition = state?.stage ? stageDefinition(record, state.stage) : null; // Used to expose the current reward label.
    const target = state?.stage ? ensureTarget(record, state) : null; // Used to expose the persistent requested buff combination.
    const labels = (target?.requiredEffects || []).map(effectLabel); // Used to present exact buff names to the player.
    return {
      '{{banubuRequestedBuffs}}': labels.length ? labels.join(' + ') : 'a feasible set of fish buffs',
      '{{banubuRewardName}}': definition?.reward?.label || 'a key item',
      '{{banubuQuestNumber}}': String(state?.stage || 0),
    };
  }

  function resolveQuestTokens(tree, record, state) { // Used to clone one editor-authored tree and fill dynamic target/reward text for this conversation only.
    const clone = CONTENT()?.deepClone ? CONTENT().deepClone(tree) : JSON.parse(JSON.stringify(tree)); // Used to avoid modifying the loaded NPC database.
    const replacements = tokenValues(record, state); // Used as the complete Banubu-only token map.
    const replace = value => { // Used for dialogue line and choice-label token substitution.
      let output = String(value ?? ''); // Used as the progressively replaced string.
      for (const [token, replacement] of Object.entries(replacements)) output = output.split(token).join(replacement);
      return output;
    };
    for (const node of clone.nodes || []) { // Used to resolve every player-visible string in the selected tree.
      if (typeof node.text === 'string') node.text = replace(node.text);
      for (const choice of node.choices || []) if (typeof choice.label === 'string') choice.label = replace(choice.label);
    }
    clone.trigger = 'interact';
    return clone;
  }

  function selectTree(record) { // Used by DialogueContent's provider hook to route Banubu through the sequential quest state machine.
    const state = ensureQuestState(); // Used as the current world-member quest state.
    if (!state) return null;
    const trees = treesForBanubu(record); // Used as the editable source graph.
    let phase = state.status || 'intro'; // Used as the authored phase key to select.
    if (phase === 'active' && matchingPie(state)) phase = 'ready';
    if (phase === 'finished') state.stage = 6;
    if (phase !== 'intro' && phase !== 'finished') ensureTarget(record, state);
    const selected = trees.find(tree => tree?.banubuQuest?.phase === phase
      && (phase === 'intro' || phase === 'finished' || Number(tree?.banubuQuest?.stage) === Number(state.stage))); // Used as the one tree eligible for this conversation.
    return selected ? resolveQuestTokens(selected, record, state) : null;
  }

  function unlockRecipe() { // Used by the intro choice to reveal the otherwise hidden three-fish template and start quest one.
    const state = ensureQuestState(); // Used to prevent repeated intro actions from rewinding later progress.
    if (!state) return { ok: false, message: 'No active save.' };
    global.BanubuQuestContent?.ensureCookingRecipe?.();
    global.CookingSystem?.unlockRecipe?.(CONTENT()?.RECIPE_ID);
    if (state.status === 'intro') {
      state.status = 'offer';
      state.stage = 1;
      state.target = null;
    }
    persistMemberState();
    debugState.lastAction = 'unlockRecipe';
    return { ok: true, message: 'Three-Fish Pie learned.' };
  }

  function acceptQuest(record, stage) { // Used by an offer-tree choice to lock in the already displayed target and begin the stage.
    const state = ensureQuestState(); // Used to validate sequential progression against the choice's authored stage.
    if (!state || state.status !== 'offer' || Number(state.stage) !== Number(stage)) return { ok: false, message: 'That fish-pie request is not currently available.' };
    if (!ensureTarget(record, state)) return { ok: false, message: 'No feasible three-fish buff combination is available from the current fish catalog.' };
    state.status = 'active';
    persistMemberState();
    debugState.lastAction = `accept:${stage}`;
    return { ok: true };
  }

  function turnInQuest(record, stage) { // Used by the ready-tree choice to consume one qualifying pie, award its key, and advance exactly one stage.
    const state = ensureQuestState(); // Used to validate the action against current sequential state.
    if (!state || state.status !== 'active' || Number(state.stage) !== Number(stage)) return { ok: false, message: 'That fish-pie request is not active.' };
    const meal = matchingPie(state); // Used to select the real inventory stack that satisfied the exact requested buff set.
    if (!meal) return { ok: false, message: 'You no longer have the requested three-fish pie.' };
    const consumed = global.CookingSystem?.consumeCookedInventoryItem?.(meal.key, 1); // Used to remove exactly one quest turn-in serving through cooking's quality-aware inventory path.
    if (!consumed?.ok) return consumed || { ok: false, message: 'Could not consume the requested pie.' };

    const definition = stageDefinition(record, stage); // Used to resolve the editable key id/label/save scope for this stage.
    const reward = { ...definition.reward }; // Used as the inline key-item definition registered and granted below.
    const grant = global.KeyItemSystem?.grant?.(reward, reward); // Used to persist character/world ownership according to the authored scope.
    if (!grant?.ok) return grant || { ok: false, message: 'Could not grant the quest reward.' };

    const completedTarget = state.target ? JSON.parse(JSON.stringify(state.target)) : null; // Used only for mobile diagnostics after state advances.
    if (Number(stage) >= 5) {
      state.status = 'finished';
      state.stage = 6;
      state.target = null;
    } else {
      state.status = 'offer';
      state.stage = Number(stage) + 1;
      state.target = null;
    }
    persistMemberState();
    debugState.lastAction = `turnIn:${stage}`;
    debugState.lastTurnIn = { stage: Number(stage), mealKey: meal.key, target: completedTarget, reward };
    return { ok: true, message: `${reward.label || reward.id} obtained.` };
  }

  function actionHandler(action, context = {}) { // Used by DialogueContent's generic custom-action registry for all Banubu quest choices.
    const operation = String(action?.operation || ''); // Used to route the editor-authored action to one state transition.
    const stage = Number(action?.stage ?? context?.tree?.banubuQuest?.stage ?? 0); // Used to bind accept/turn-in actions to their sequential stage.
    const record = context.npc; // Used to read editor-authored stage metadata and trees.
    let result = null; // Used as the normalized action outcome returned to DialogueContent.
    if (operation === 'unlockRecipe') result = unlockRecipe();
    else if (operation === 'accept') result = acceptQuest(record, stage);
    else if (operation === 'turnIn') result = turnInQuest(record, stage);
    else result = { ok: false, message: `Unknown Banubu quest operation: ${operation || '(blank)'}` };
    if (!result?.ok) debugState.lastError = result?.message || 'Banubu quest action failed.';
    return { ...result, skipNav: !result?.ok };
  }

  function diagnosticsText() { // Used by the cooking diagnostics panel so mobile players can inspect the quest without a console.
    const state = ensureQuestState(); // Used as the current progression snapshot.
    const matching = state?.status === 'active' ? matchingPie(state) : null; // Used to show whether a valid turn-in is presently detected.
    const target = state?.target; // Used to render the saved target and hidden feasibility witness.
    return [
      'Banubu quest:',
      `  installed=${installed}`,
      `  status=${state?.status || 'unavailable'} stage=${state?.stage ?? '-'}`,
      `  requested=${(target?.requiredEffects || []).map(effectLabel).join(' + ') || 'none'}`,
      `  proofFish=${(target?.solutionFishKeys || []).join(', ') || 'none'}`,
      `  matchingPie=${matching?.key || 'none'}`,
      `  lastAction=${debugState.lastAction || 'none'}`,
      `  lastError=${debugState.lastError || 'none'}`,
    ].join('\n');
  }

  function install() { // Used to register the quest only after DialogueContent, CookingSystem, key items, and static content are ready.
    if (installed) return true;
    if (!global.DialogueContent?.registerTreeProvider || !global.DialogueContent?.registerActionHandler
      || !global.CookingSystem?.unlockRecipe || !global.KeyItemSystem || !CONTENT()) return false;
    CONTENT().ensureCookingRecipe?.();
    global.DialogueContent.registerTreeProvider(CONTENT().NPC_ID, selectTree);
    global.DialogueContent.registerActionHandler('banubuQuest', actionHandler);
    for (const fallback of CONTENT().stageDefaults || []) { // Used to make feature gates/query labels available even before the player earns a reward.
      global.KeyItemSystem.define(fallback.reward);
    }
    installed = true;
    return true;
  }

  function beginInstallPolling() { // Used to survive script/game initialization ordering without adding per-frame checks.
    if (install()) return;
    installStartedAt = Date.now();
    installTimer = global.setInterval(() => {
      if (install() || Date.now() - installStartedAt >= INSTALL_TIMEOUT_MS) {
        global.clearInterval(installTimer);
        installTimer = null;
      }
    }, INSTALL_INTERVAL_MS);
  }

  global.BanubuQuestline = {
    install,
    selectTree,
    ensureQuestState,
    stageDefinition,
    allFeasibleTargets,
    effectSetForFishKeys,
    matchingPie,
    unlockRecipe,
    acceptQuest,
    turnInQuest,
    diagnosticsText,
    debugSnapshot: () => ({ installed, ...JSON.parse(JSON.stringify(debugState)), state: JSON.parse(JSON.stringify(ensureQuestState() || null)) }),
  };

  if (typeof document !== 'undefined') beginInstallPolling();
})();
