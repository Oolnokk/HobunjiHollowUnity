// Banubu's authored two-stage quest controller.
// Quest 1 requests a demonstrably craftable Three-Fish Pie; Quest 2 requests
// a demonstrably craftable Nine Leaf Tea. Stages 3–5 are deliberately blocked.
(() => {
  'use strict';

  const global = window; // Used as the shared runtime namespace.
  const QUEST_ID = 'banubu_fish_pies'; // Preserved from the prototype so prior test/dev saves migrate into the authored sequence.
  const INSTALL_INTERVAL_MS = 250; // Used by the bounded dependency installer while game modules initialize.
  const INSTALL_TIMEOUT_MS = 20000; // Used to stop active polling once late global assignment hooks are sufficient.

  let installed = false; // Used to make runtime integration idempotent.
  let runtimeDeps = null; // Injected by game.js so Banubu mutates the exact live questProgress object rendered by TasksPanel instead of a detached profile copy.
  let installTimer = null; // Used to stop dependency polling after success/timeout.
  let installStartedAt = 0; // Used to bound dependency polling on editor/partial pages.
  const debugState = { lastAction: null, lastTarget: null, lastTurnIn: null, lastError: null }; // Used by mobile diagnostics/tests.

  function CONTENT() { return global.BanubuQuestContent || null; } // Used so the static content module may load before or after this controller.
  function playerData() { return global.__hobunjiPlayerProfile || null; } // Used as the live world-member quest/cooking mirror.

  function readMeta() {
    try { return JSON.parse(global.localStorage?.getItem('hobunjiSaveMeta') || 'null'); } catch (_) { return null; } // Fallback persistence for tests/partial pages where game.js has not injected its live quest store.
  }

  function questStore() {
    const injected = runtimeDeps?.getQuestProgress?.();
    if (injected && typeof injected === 'object') {
      const profile = playerData();
      if (profile && profile.questProgress !== injected) profile.questProgress = injected; // Keeps public profile diagnostics and Banubu's controller on the exact same object as game.js/TasksPanel.
      return injected;
    }
    const profile = playerData();
    if (!profile) return null;
    if (!profile.questProgress || typeof profile.questProgress !== 'object') profile.questProgress = {};
    return profile.questProgress;
  }

  function persistMemberState() {
    const liveStore = questStore();
    const profile = playerData();
    if (profile && liveStore) profile.questProgress = liveStore;
    if (typeof runtimeDeps?.saveMemberWorldData === 'function') {
      runtimeDeps.saveMemberWorldData(); // Canonical game save path; prevents a direct localStorage write being overwritten later by game.js's detached questProgress copy.
      return true;
    }
    const meta = readMeta(); // Used only by tests/editor/partial runtime without game dependency injection.
    if (!profile?.characterId || !profile?.worldId || !meta) return false;
    const world = meta.worlds?.find(entry => entry?.id === profile.worldId);
    const member = world?.members?.[profile.characterId];
    if (!member) return false;
    member.questProgress = JSON.parse(JSON.stringify(liveStore || {}));
    if (global.CookingSystem?.serialize) {
      profile.cookingState = global.CookingSystem.serialize();
      member.cookingState = JSON.parse(JSON.stringify(profile.cookingState));
    }
    try { global.localStorage?.setItem('hobunjiSaveMeta', JSON.stringify(meta)); return true; } catch (_) { return false; }
  }

  function ensureQuestState() {
    const store = questStore();
    if (!store) return null;
    let state = store[QUEST_ID];
    if (!state || typeof state !== 'object') {
      state = { status: 'intro', stage: 0, introTalkAttempts: 0, target: null, nextTarget: null, progress: { kind: 'story', provider: 'banubu', hidden: true } };
      store[QUEST_ID] = state;
      persistMemberState();
      return state;
    }
    let migrated = false; // Used to persist only when an old five-fish-pie prototype state actually needs correction.
    if (Number(state.stage) >= 3 || state.status === 'finished') {
      state.status = 'blocked';
      state.stage = 3;
      state.target = null;
      state.nextTarget = null;
      migrated = true;
    } else if (Number(state.stage) === 2 && state.target && state.target.questType !== 'nineLeafTea') {
      state.target = null; // Old prototype stage-two fish targets are invalid now that stage two is Nine Leaf Tea.
      migrated = true;
    } else if (Number(state.stage) === 1 && state.target && !state.target.questType) {
      state.target.questType = 'threeFishPie'; // Legacy stage-one targets already contain a valid fish proof; tag rather than reroll them.
      migrated = true;
    }
    if (!Object.prototype.hasOwnProperty.call(state, 'nextTarget')) {
      state.nextTarget = null;
      migrated = true;
    }
    if (!Object.prototype.hasOwnProperty.call(state, 'introTalkAttempts')) {
      state.introTalkAttempts = state.status === 'intro' ? 0 : 3; // Existing progressed saves have already completed the wake-up sequence; untouched intro saves start from the first snore.
      migrated = true;
    } else {
      const attempts = Math.max(0, Math.min(3, Math.trunc(Number(state.introTalkAttempts) || 0)));
      if (attempts !== state.introTalkAttempts) { state.introTalkAttempts = attempts; migrated = true; }
    }
    syncTaskDescriptor(state);
    if (migrated) persistMemberState();
    return state;
  }

  function treesForBanubu(record) {
    const authored = (record?.dialogueTrees || []).filter(tree => tree?.banubuQuest); // Used as the Dialogue Editor-authoritative tree set.
    return authored.length ? authored : (CONTENT()?.dialogueTrees || []);
  }

  function stageDefinition(record, stage) {
    const offer = treesForBanubu(record).find(tree => Number(tree?.banubuQuest?.stage) === Number(stage) && tree?.banubuQuest?.phase === 'offer'); // Used as canonical editable stage metadata.
    const fallback = CONTENT()?.stageDefaults?.find(entry => Number(entry.stage) === Number(stage));
    const meta = offer?.banubuQuest || {};
    const reward = meta.reward === null ? null : (meta.reward || fallback?.reward ? { ...(fallback?.reward || {}), ...(meta.reward || {}) } : null);
    return {
      stage: Number(stage),
      questType: String(meta.questType || fallback?.questType || (Number(stage) === 2 ? 'nineLeafTea' : 'threeFishPie')),
      buffCount: Math.max(1, Math.min(3, Number(meta.buffCount ?? fallback?.buffCount) || 1)),
      minStacks: Math.max(1, Math.min(9, Number(meta.minStacks ?? fallback?.minStacks) || 1)),
      reward,
    };
  }

  function ingredientEffectKeys(definition) {
    const explicit = definition?.foodEffects && typeof definition.foodEffects === 'object'
      ? Object.keys(definition.foodEffects).filter(key => Number(definition.foodEffects[key]) > 0)
      : []; // Used when an ingredient has authored multi-effect cooking data.
    if (explicit.length) return explicit.sort();
    return definition?.cookingPrimaryEffect ? [String(definition.cookingPrimaryEffect)] : [];
  }

  function effectSetForFishKeys(fishKeys) {
    const ingredients = global.CookingSystem?.listIngredientDefinitions?.('fish') || []; // Used as the current live fish/effect catalog.
    const byKey = new Map(ingredients.map(entry => [entry.key, entry.definition]));
    const effects = new Set();
    for (const key of fishKeys || []) {
      const definition = byKey.get(key);
      for (const effect of ingredientEffectKeys(definition)) effects.add(effect);
    }
    return [...effects].sort();
  }

  function allFeasibleFishTargets(desiredCount) {
    const fishes = global.CookingSystem?.listIngredientDefinitions?.('fish') || [];
    const candidates = fishes.filter(entry => ingredientEffectKeys(entry.definition).length);
    const bySignature = new Map(); // Used to retain one concrete three-fish witness per exact effect set.
    for (let a = 0; a < candidates.length; a++) {
      for (let b = a; b < candidates.length; b++) {
        for (let c = b; c < candidates.length; c++) {
          const keys = [candidates[a].key, candidates[b].key, candidates[c].key];
          const effects = effectSetForFishKeys(keys);
          if (effects.length !== desiredCount) continue; // Quest text promises this exact number; never silently lower the difficulty.
          const signature = effects.join('|');
          if (!bySignature.has(signature)) {
            bySignature.set(signature, {
              questType: 'threeFishPie',
              requiredEffects: effects,
              minStacks: 1,
              solutionFishKeys: keys,
            });
          }
        }
      }
    }
    return [...bySignature.values()];
  }

  function allFeasibleTeaTargets(desiredCount = 2, minStacks = 3) {
    const witnesses = global.TeaGrinder?.allBlendEffects?.() || []; // Used as one concrete reagent-trio proof for every buff the Tea Grinder can actually create.
    if (desiredCount !== 2 || witnesses.length < 2) return [];
    const targets = [];
    for (let a = 0; a < witnesses.length - 1; a++) {
      for (let b = a + 1; b < witnesses.length; b++) {
        const left = witnesses[a], right = witnesses[b];
        const effects = [left.effect, right.effect].sort();
        targets.push({
          questType: 'nineLeafTea',
          requiredEffects: effects,
          minStacks,
          solutionBlendEffects: [left.effect, right.effect, left.effect], // Two/one split yields +6/+3 with Concentrated (+3) Tea Blends.
          solutionReagentTrios: [
            [...left.reagentKeys],
            [...right.reagentKeys],
            [...left.reagentKeys],
          ],
        });
      }
    }
    return targets;
  }

  function rollTarget(record, stage) {
    const definition = stageDefinition(record, stage);
    const feasible = definition.questType === 'nineLeafTea'
      ? allFeasibleTeaTargets(definition.buffCount, definition.minStacks)
      : allFeasibleFishTargets(definition.buffCount);
    if (!feasible.length) return null;
    const index = Math.floor((global.GameRandom?.random?.() ?? Math.random()) * feasible.length); // Used to keep gameplay randomness seedable when GameRandom is available.
    const target = JSON.parse(JSON.stringify(feasible[index]));
    debugState.lastTarget = { stage: Number(stage), desiredBuffCount: definition.buffCount, ...target };
    return target;
  }

  function ensureTarget(record, state) {
    if (state?.target?.requiredEffects?.length) return state.target;
    if (!state || Number(state.stage) < 1 || Number(state.stage) > 2) return null;
    const target = rollTarget(record, state.stage);
    if (!target) return null;
    state.target = target;
    persistMemberState();
    return target;
  }

  function ensureIntroTarget(record, state) {
    if (!state || state.status !== 'intro') return null;
    if (state.target?.questType === 'threeFishPie' && state.target.requiredEffects?.length) return state.target;
    const target = rollTarget(record, 1); // Used before the intro tree is rendered so its dynamic buff names are already concrete.
    if (!target) return null;
    state.target = target;
    persistMemberState();
    return target;
  }

  function ensureNextTarget(record, state) {
    if (!state || Number(state.stage) !== 1) return null;
    if (state.nextTarget?.questType === 'nineLeafTea' && state.nextTarget.requiredEffects?.length) return state.nextTarget;
    const target = rollTarget(record, 2); // Used while Quest 1's ready tree is rendered so its later Tea dialogue can name Quest 2 buffs before the turn-in action fires.
    if (!target) return null;
    state.nextTarget = target;
    persistMemberState();
    return target;
  }

  function sameEffectSet(left, right) {
    const a = [...new Set(left || [])].sort();
    const b = [...new Set(right || [])].sort();
    return a.length === b.length && a.every((entry, index) => entry === b[index]);
  }

  function mealMatchesTarget(entry, state) {
    const target = state?.target;
    if (!target?.requiredEffects?.length) return false;
    const recipeId = target.questType === 'nineLeafTea' ? CONTENT()?.NINE_LEAF_TEA_RECIPE_ID : CONTENT()?.THREE_FISH_PIE_RECIPE_ID;
    if (entry.definition?.recipeId !== recipeId) return false;
    const foodEffects = entry.definition?.foodEffects || {};
    const present = Object.keys(foodEffects).filter(key => Number(foodEffects[key]) > 0);
    if (!sameEffectSet(present, target.requiredEffects)) return false; // Unrequested extra buffs do not satisfy Banubu's exact order.
    const minimum = Math.max(1, Number(target.minStacks) || 1);
    return target.requiredEffects.every(effect => Number(foodEffects[effect]) >= minimum); // Quest 2 requires both requested buffs to reach Concentrated strength.
  }

  function matchingMeal(state) {
    const meals = global.CookingSystem?.listCookedInventory?.() || [];
    return meals.find(entry => mealMatchesTarget(entry, state)) || null;
  }

  function matchingPie(state) { return matchingMeal(state); } // Compatibility alias retained for old diagnostics/tests.

  function effectLabel(effectKey) {
    return global.CookingSystem?.effectLabel?.(effectKey)
      || String(effectKey).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, character => character.toUpperCase());
  }

  function strengthLabel(stacks) {
    return global.CookingSystem?.effectStrengthLabel?.(stacks) || (Number(stacks) >= 3 ? 'Concentrated' : 'Mild');
  }

  function joinedEffectLabels(target) {
    const labels = (target?.requiredEffects || []).map(effectLabel);
    if (!labels.length) return 'a feasible set of buffs';
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
  }

  function taskDescriptor(state) {
    const stage = Number(state?.stage) || 0;
    const target = state?.target || null;
    const activeStage = stage === 1 || stage === 2;
    const questType = target?.questType || (stage === 2 ? 'nineLeafTea' : 'threeFishPie');
    const recipeName = questType === 'nineLeafTea' ? 'Nine Leaf Tea' : 'Three-Fish Pie';
    const strength = Math.max(1, Number(target?.minStacks) || (stage === 2 ? 3 : 1));
    const requested = joinedEffectLabels(target);
    const objective = questType === 'nineLeafTea'
      ? `Cook Nine Leaf Tea with ${requested}, both at ${strengthLabel(strength)} (+${strength}) or stronger.`
      : `Cook a Three-Fish Pie that provides ${requested}.`;
    const detail = questType === 'nineLeafTea'
      ? 'Use three Tea Blends plus White Milk; each Tea Blend is made from exactly three herbs in Banubu’s Tea Grinder.'
      : 'Use exactly three fish. Bring the finished pie back to Banubu.';
    return {
      kind: 'story',
      provider: 'banubu',
      npcId: CONTENT()?.NPC_ID || 'banubu',
      npcName: 'Banubu',
      title: activeStage ? `Banubu — ${recipeName}` : 'Banubu',
      icon: questType === 'nineLeafTea' ? '🍵' : '🥧',
      stage,
      questType,
      objective,
      detail,
      requiredEffects: [...(target?.requiredEffects || [])],
      minStacks: strength,
      hidden: state?.status !== 'active',
    };
  }

  function syncTaskDescriptor(state) {
    if (!state || typeof state !== 'object') return null;
    state.progress = { ...(state.progress || {}), ...taskDescriptor(state) }; // Keeps authored stage-machine fields and the shared TasksPanel descriptor in the same saved quest record.
    return state.progress;
  }

  function menuStatus() {
    const state = ensureQuestState();
    if (!state || state.status !== 'active') return { active: false, ready: false };
    const meal = matchingMeal(state);
    return {
      active: true,
      ready: !!meal,
      mealKey: meal?.key || null,
      stage: Number(state.stage) || 0,
      objective: state.progress?.objective || taskDescriptor(state).objective,
    };
  }

  function tokenValues(record, state) {
    const currentTarget = state?.status === 'intro' ? ensureIntroTarget(record, state) : (state?.stage ? ensureTarget(record, state) : null);
    const nextTarget = Number(state?.stage) === 1 ? ensureNextTarget(record, state) : null;
    const definition = state?.stage ? stageDefinition(record, state.stage) : stageDefinition(record, 1);
    return {
      '{{banubuRequestedBuffs}}': joinedEffectLabels(currentTarget),
      '{{banubuNextRequestedBuffs}}': joinedEffectLabels(nextTarget),
      '{{banubuRequiredStrength}}': strengthLabel(currentTarget?.minStacks || definition?.minStacks || 1),
      '{{banubuNextRequiredStrength}}': strengthLabel(nextTarget?.minStacks || 3),
      '{{banubuRewardName}}': definition?.reward?.label || 'no item reward',
      '{{banubuQuestNumber}}': String(state?.stage || 0),
    };
  }

  function resolveQuestTokens(tree, record, state) {
    const clone = CONTENT()?.deepClone ? CONTENT().deepClone(tree) : JSON.parse(JSON.stringify(tree));
    const replacements = tokenValues(record, state);
    const replace = value => {
      let output = String(value ?? '');
      for (const [token, replacement] of Object.entries(replacements)) output = output.split(token).join(replacement);
      return output;
    };
    for (const node of clone.nodes || []) {
      if (typeof node.text === 'string') node.text = replace(node.text);
      for (const choice of node.choices || []) if (typeof choice.label === 'string') choice.label = replace(choice.label);
    }
    clone.trigger = 'interact';
    return clone;
  }

  function selectTree(record) {
    const state = ensureQuestState();
    if (!state) return null;
    const trees = treesForBanubu(record);
    let phase = state.status || 'intro';
    let introAttempt = 3;
    if (phase === 'intro') {
      ensureIntroTarget(record, state);
      introAttempt = Math.min(3, Math.max(1, (Number(state.introTalkAttempts) || 0) + 1)); // Exactly one wake-up step is consumed per distinct conversation attempt.
      if (introAttempt !== state.introTalkAttempts) {
        state.introTalkAttempts = introAttempt;
        persistMemberState();
      }
    } else if (phase === 'active' && matchingMeal(state)) phase = 'ready';
    else if (phase === 'offer' || phase === 'active') ensureTarget(record, state);
    if (phase === 'blocked') state.stage = 3;
    if (record) record._animalDialogueEyesOpen = phase !== 'intro' || introAttempt >= 3; // Shared named-animal sleep presenter reads this only while dialogue is actually open; outside dialogue Banubu's eyes remain shut.
    const selected = trees.find(tree => tree?.banubuQuest?.phase === phase
      && (phase === 'intro'
        ? Number(tree?.banubuQuest?.introAttempt || 3) === introAttempt
        : Number(tree?.banubuQuest?.stage) === Number(state.stage)));
    return selected ? resolveQuestTokens(selected, record, state) : null;
  }

  function dialogueEyesOpen() {
    const state = ensureQuestState();
    return !!state && (state.status !== 'intro' || Number(state.introTalkAttempts) >= 3);
  }

  function unlockRecipe(record = null) {
    const state = ensureQuestState();
    if (!state) return { ok: false, message: 'No active save.' };
    CONTENT()?.ensureCookingRecipes?.();
    const unlock = global.CookingSystem?.unlockRecipe?.(CONTENT()?.THREE_FISH_PIE_RECIPE_ID); // Used to keep quest state from advancing if the authored cooking recipe is unavailable.
    if (!unlock?.ok) return unlock || { ok: false, message: 'Three-Fish Pie could not be learned.' };
    if (state.status === 'intro') {
      const introTarget = state.target?.questType === 'threeFishPie' ? state.target : rollTarget(record, 1);
      if (!introTarget) return { ok: false, message: 'The current fish catalog cannot produce a Three-Fish Pie with three distinct buffs.' };
      state.status = 'offer';
      state.stage = 1;
      state.target = introTarget;
      state.nextTarget = null;
    }
    syncTaskDescriptor(state);
    persistMemberState();
    debugState.lastAction = 'unlockRecipe';
    return { ok: true, message: 'Three-Fish Pie learned.' };
  }

  function acceptQuest(record, stage) {
    const state = ensureQuestState();
    if (!state || state.status !== 'offer' || Number(state.stage) !== Number(stage) || Number(stage) > 2) return { ok: false, message: 'That Banubu request is not currently available.' };
    if (!ensureTarget(record, state)) return { ok: false, message: Number(stage) === 2 ? 'No feasible Nine Leaf Tea buff pair exists in the current Tea Grinder reaction set.' : 'No feasible three-buff Three-Fish Pie exists in the current fish catalog.' };
    state.status = 'active';
    syncTaskDescriptor(state);
    persistMemberState();
    debugState.lastAction = `accept:${stage}`;
    return { ok: true };
  }

  function grantStageReward(definition) {
    if (!definition?.reward?.id) return { ok: true, reward: null };
    const reward = { ...definition.reward };
    const grant = global.KeyItemSystem?.grant?.(reward, reward);
    return grant?.ok ? { ok: true, reward } : (grant || { ok: false, message: 'Could not grant the quest reward.' });
  }

  function unlockTeaSetup() {
    CONTENT()?.ensureCookingRecipes?.();
    const unlock = global.CookingSystem?.unlockRecipe?.(CONTENT()?.NINE_LEAF_TEA_RECIPE_ID); // Used to prevent a Tea Grinder reward from advancing the quest without its required tea recipe.
    if (!unlock?.ok) return unlock || { ok: false, message: 'Nine Leaf Tea could not be learned.' };
    const station = global.TeaGrinder?.grantStation?.();
    return station?.ok ? { ok: true, station } : (station || { ok: false, message: 'Could not give you Banubu’s Tea Grinder.' });
  }

  function turnInQuest(record, stage) {
    const state = ensureQuestState();
    if (!state || state.status !== 'active' || Number(state.stage) !== Number(stage) || Number(stage) > 2) return { ok: false, message: 'That Banubu request is not active.' };
    const meal = matchingMeal(state);
    if (!meal) return { ok: false, message: Number(stage) === 2 ? 'You no longer have the requested Nine Leaf Tea.' : 'You no longer have the requested Three-Fish Pie.' };

    const definition = stageDefinition(record, stage);
    const completedTarget = state.target ? JSON.parse(JSON.stringify(state.target)) : null;
    const preparedNextTarget = Number(stage) === 1
      ? (state.nextTarget?.questType === 'nineLeafTea' ? JSON.parse(JSON.stringify(state.nextTarget)) : rollTarget(record, 2))
      : null; // Used to prove Quest 2 remains craftable before any Quest 1 turn-in rewards or food consumption occur.
    if (Number(stage) === 1 && !preparedNextTarget) return { ok: false, message: 'Quest 2 could not find a craftable Tea Blend buff pair.' };

    const rewardResult = grantStageReward(definition);
    if (!rewardResult.ok) return rewardResult;

    let teaSetup = null;
    if (Number(stage) === 1) {
      teaSetup = unlockTeaSetup();
      if (!teaSetup.ok) return teaSetup;
    }

    const consumed = global.CookingSystem?.consumeCookedInventoryItem?.(meal.key, 1);
    if (!consumed?.ok) return consumed || { ok: false, message: 'Could not consume the requested food.' };

    if (Number(stage) === 1) {
      state.status = 'offer';
      state.stage = 2;
      state.target = preparedNextTarget;
      state.nextTarget = null;
    } else {
      state.status = 'blocked'; // Quests 3–5 intentionally stop here until their authored dialogue/design exists.
      state.stage = 3;
      state.target = null;
      state.nextTarget = null;
    }

    syncTaskDescriptor(state);
    persistMemberState();
    debugState.lastAction = `turnIn:${stage}`;
    debugState.lastTurnIn = {
      stage: Number(stage),
      mealKey: meal.key,
      target: completedTarget,
      reward: rewardResult.reward,
      teaGrinder: teaSetup?.station?.itemKey || null,
      nextStatus: state.status,
    };
    const messages = [];
    if (rewardResult.reward) messages.push(`${rewardResult.reward.label || rewardResult.reward.id} obtained.`);
    if (teaSetup?.station) messages.push('Tea Grinder obtained and Nine Leaf Tea learned.');
    return { ok: true, message: messages.join(' ') || 'Banubu accepted it.' };
  }

  function actionHandler(action, context = {}) {
    const operation = String(action?.operation || '');
    const stage = Number(action?.stage ?? context?.tree?.banubuQuest?.stage ?? 0);
    const record = context.npc;
    let result = null;
    if (operation === 'unlockRecipe') result = unlockRecipe(record);
    else if (operation === 'accept') result = acceptQuest(record, stage);
    else if (operation === 'turnIn') result = turnInQuest(record, stage);
    else result = { ok: false, message: `Unknown Banubu quest operation: ${operation || '(blank)'}` };
    if (!result?.ok) debugState.lastError = result?.message || 'Banubu quest action failed.';
    return { ...result, skipNav: !result?.ok };
  }

  function diagnosticsText() {
    const state = ensureQuestState();
    const matching = state?.status === 'active' ? matchingMeal(state) : null;
    const target = state?.target;
    return [
      'Banubu quest:',
      `  installed=${installed}`,
      `  status=${state?.status || 'unavailable'} stage=${state?.stage ?? '-'}`,
      `  introTalkAttempts=${state?.introTalkAttempts ?? '-'} dialogueEyesOpen=${dialogueEyesOpen()}`,
      `  questType=${target?.questType || 'none'}`,
      `  requested=${joinedEffectLabels(target)}`,
      `  minimumStrength=${target ? strengthLabel(target.minStacks || 1) + ' (+' + (target.minStacks || 1) + ')' : 'none'}`,
      `  proofFish=${(target?.solutionFishKeys || []).join(', ') || 'none'}`,
      `  proofTeaBlends=${(target?.solutionBlendEffects || []).join(', ') || 'none'}`,
      `  proofTeaTrios=${(target?.solutionReagentTrios || []).map(trio => '[' + trio.join(',') + ']').join(' ') || 'none'}`,
      `  matchingMeal=${matching?.key || 'none'}`,
      `  nextTarget=${state?.nextTarget ? joinedEffectLabels(state.nextTarget) : 'none'}`,
      `  lastAction=${debugState.lastAction || 'none'}`,
      `  lastError=${debugState.lastError || 'none'}`,
    ].join('\n');
  }

  function init(injectedDeps) {
    runtimeDeps = injectedDeps || runtimeDeps; // Getter closures remain valid when game.js later replaces questProgress during save-load.
    return install();
  }

  function install() {
    if (installed) return true;
    if (!global.DialogueContent?.registerTreeProvider || !global.DialogueContent?.registerActionHandler
      || !global.CookingSystem?.unlockRecipe || !global.KeyItemSystem || !global.TeaGrinder?.allBlendEffects || !CONTENT()) return false;
    CONTENT().ensureCookingRecipes?.();
    global.TeaGrinder.registerItemDefs?.();
    global.DialogueContent.registerTreeProvider(CONTENT().NPC_ID, selectTree);
    global.DialogueContent.registerActionHandler('banubuQuest', actionHandler);
    global.KeyItemSystem.defineMany?.(CONTENT().keyItems || []); // Keeps reserved Banubu key items registered even when a particular quest no longer grants them.
    for (const fallback of CONTENT().stageDefaults || []) if (fallback?.reward?.id) global.KeyItemSystem.define(fallback.reward);
    installed = true;
    return true;
  }

  function beginInstallPolling() {
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
    init,
    install,
    selectTree,
    dialogueEyesOpen,
    ensureQuestState,
    stageDefinition,
    allFeasibleTargets: allFeasibleFishTargets,
    allFeasibleFishTargets,
    allFeasibleTeaTargets,
    effectSetForFishKeys,
    matchingPie,
    matchingMeal,
    unlockRecipe,
    acceptQuest,
    turnInQuest,
    menuStatus,
    taskDescriptor,
    diagnosticsText,
    debugSnapshot: () => ({ installed, ...JSON.parse(JSON.stringify(debugState)), state: JSON.parse(JSON.stringify(ensureQuestState() || null)) }),
  };

  if (typeof document !== 'undefined') beginInstallPolling();
})();
