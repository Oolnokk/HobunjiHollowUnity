// Banubu authored quest/dialogue content.
// Kept separate from the giant starter NPC database so the Dialogue Editor can
// author this sequence without reintroducing generic villager chatter.
(() => {
  'use strict';

  const NPC_ID = 'banubu'; // Used to replace only Banubu's dialogue surface during NPC database composition.
  const THREE_FISH_PIE_RECIPE_ID = 'banubuThreeFishPie'; // Used by Quest 1 matching/unlock logic.
  const NINE_LEAF_TEA_RECIPE_ID = 'banubuNineLeafTea'; // Used by Quest 2 matching/unlock logic.
  const QUEST_ID = 'banubu_fish_pies'; // Preserved from the prototype so existing test/dev saves migrate instead of forking state.
  const WAR_PAINT_KIT = Object.freeze({ id: 'war_paint_kit', label: 'War-Paint Kit', scope: 'character', featureId: 'war_paint' }); // Reserved character-scoped item for the later war-paint feature; Banubu no longer grants it here.
  const COLOR_POOLS_KEY = Object.freeze({ id: 'color_pools_key', label: 'Color Pools Key', scope: 'world', featureId: 'color_pools' }); // World-scoped access key shared by every character who visits this world.
  const KEY_ITEMS = Object.freeze([WAR_PAINT_KIT, COLOR_POOLS_KEY]); // Registered together so the reserved kit remains a real item even while only the key is awarded.

  const THREE_FISH_PIE_RECIPE = Object.freeze({
    id: THREE_FISH_PIE_RECIPE_ID,
    name: 'Three-Fish Pie',
    description: 'Banubu’s favorite pie: exactly three fish, carrying whatever cooking buffs those fish provide.',
    baseOutputName: 'Three-Fish Pie',
    outputIcon: '🥧',
    lockedByDefault: true,
    slots: Object.freeze([
      Object.freeze({ id: 'fishA', label: 'First Fish', accepts: Object.freeze(['fish']), required: true }),
      Object.freeze({ id: 'fishB', label: 'Second Fish', accepts: Object.freeze(['fish']), required: true }),
      Object.freeze({ id: 'fishC', label: 'Third Fish', accepts: Object.freeze(['fish']), required: true }),
    ]),
    outputTags: Object.freeze(['Meal', 'Pie', 'Fish', 'Banubu']),
  });

  const NINE_LEAF_TEA_RECIPE = Object.freeze({
    id: NINE_LEAF_TEA_RECIPE_ID,
    name: 'Nine Leaf Tea',
    description: 'Three Tea Blends—each ground from three herbs—finished with White Milk.',
    baseOutputName: 'Nine Leaf Tea',
    outputIcon: '🍵',
    lockedByDefault: true,
    slots: Object.freeze([
      Object.freeze({ id: 'blendA', label: 'First Tea Blend', accepts: Object.freeze(['teaBlend']), required: true }),
      Object.freeze({ id: 'blendB', label: 'Second Tea Blend', accepts: Object.freeze(['teaBlend']), required: true }),
      Object.freeze({ id: 'blendC', label: 'Third Tea Blend', accepts: Object.freeze(['teaBlend']), required: true }),
      Object.freeze({ id: 'milk', label: 'White Milk', accepts: Object.freeze(['whiteMilk']), required: true, contributesEffects: false }),
    ]),
    outputTags: Object.freeze(['Meal', 'Tea', 'Banubu']),
  });

  function questMeta(phase, stage, extra = {}) {
    return { phase, stage, ...extra }; // Used by runtime tree routing and Dialogue Editor quest controls.
  }

  function textNode(id, text, next = null) {
    return { id, type: 'text', text, next, pos: { x: 80, y: 80 }, expression: 'neutral', expressionHold: 2, revealSpeed: 'normal' };
  }

  function choiceNode(id, text, choices) {
    return { id, type: 'choice', text, choices, pos: { x: 80, y: 80 }, expression: 'neutral', expressionHold: 2, revealSpeed: 'normal' };
  }

  function tree(id, label, phase, stage, entryNode, nodes, extra = {}) {
    return {
      id,
      label,
      trigger: 'interact',
      priority: 95,
      entryNode,
      conditions: {},
      excludeConditions: {},
      banubuQuest: questMeta(phase, stage, extra),
      nodes,
    }; // Used to keep every Banubu interaction explicitly quest-routed rather than situational/daily.
  }

  const INTRO_SLEEP_1 = tree(
    'banubu_intro_sleep_1',
    'Banubu — Still Sleeping I',
    'intro',
    0,
    'banubu_intro_sleep_1_line',
    [
      textNode('banubu_intro_sleep_1_line', 'Zzzzz.', null),
    ],
    { questType: 'threeFishPie', buffCount: 3, minStacks: 1, introAttempt: 1 },
  );

  const INTRO_SLEEP_2 = tree(
    'banubu_intro_sleep_2',
    'Banubu — Still Sleeping II',
    'intro',
    0,
    'banubu_intro_sleep_2_line',
    [
      textNode('banubu_intro_sleep_2_line', 'Let me rest my eyes for just a few more minutes.', null),
    ],
    { questType: 'threeFishPie', buffCount: 3, minStacks: 1, introAttempt: 2 },
  );

  const INTRO_TREE = tree(
    'banubu_intro',
    'Banubu — Ask for Help',
    'intro',
    0,
    'banubu_intro_3',
    [
      choiceNode('banubu_intro_3', 'Alright, alright, I’m up. What do you want?', [
        {
          label: 'Ask for help',
          next: 'banubu_intro_4',
          actions: [{ type: 'banubuQuest', operation: 'unlockRecipe', stage: 0 }],
        },
      ], { cameraId: 'banubu_dialogue_awake' }),
      textNode('banubu_intro_4', 'Oh, those glowy fellows? Yeah, I wish they’d leave me alone too. I get real bad dreams when they’re around.', 'banubu_intro_5'),
      textNode('banubu_intro_5', 'I’d love to help, and I get how urgent this all is with your little village and all that, but I’m in a bit of a pickle. I’m just so dang sleepy these days. Even if I got up, I ain’t got the energy to be much help.', 'banubu_intro_6'),
      textNode('banubu_intro_6', 'I think if I only had something good to eat, maybe it’d give me enough of a push to get moving. But I’m far too tired to get up and hunt.', 'banubu_intro_7'),
      textNode('banubu_intro_7', 'Huh. You know what? Maybe you could help me.', 'banubu_intro_8'),
      textNode('banubu_intro_8', 'You know what always revitalizes me? A good Three-Fish Pie. It’s my favorite. I’ll teach you the recipe. If you can make me one, that could give me the boost I need to at least get up and start moving.', 'banubu_intro_9'),
      textNode('banubu_intro_9', 'But if you want me to be any real help, it’s gotta be really nutritious. I’ve been lying here an awfully long time, even by my standards.', 'banubu_intro_10'),
      textNode('banubu_intro_10', 'I need a good Three-Fish Pie that can give me {{banubuRequestedBuffs}}.', 'banubu_intro_11'),
      textNode('banubu_intro_11', 'Bring me one of those and we can get started.', null),
    ],
    { questType: 'threeFishPie', buffCount: 3, minStacks: 1, introAttempt: 3 },
  );

  const Q1_OFFER = tree(
    'banubu_q1_offer',
    'Quest 1 — Three-Fish Pie Request',
    'offer',
    1,
    'banubu_q1_offer_1',
    [
      choiceNode('banubu_q1_offer_1', 'Zzz… Oh. Right. The pie. Three fish, and it needs to give me {{banubuRequestedBuffs}}.', [
        { label: 'I’ll make it.', next: 'banubu_q1_offer_2', actions: [{ type: 'banubuQuest', operation: 'accept', stage: 1 }] },
        { label: 'Not yet.', next: null, actions: [] },
      ]),
      textNode('banubu_q1_offer_2', 'Good. Wake me when it smells ready. Or don’t. I’ll probably smell it.', null),
    ],
    {
      questType: 'threeFishPie',
      buffCount: 3,
      minStacks: 1,
      reward: COLOR_POOLS_KEY,
    },
  );

  const Q1_ACTIVE = tree(
    'banubu_q1_active',
    'Quest 1 — Waiting for Three-Fish Pie',
    'active',
    1,
    'banubu_q1_active_1',
    [
      textNode('banubu_q1_active_1', 'Zzzzz… Three-Fish Pie… {{banubuRequestedBuffs}}…', null),
    ],
    { questType: 'threeFishPie', buffCount: 3, minStacks: 1 },
  );

  const Q1_READY = tree(
    'banubu_q1_ready',
    'Quest 1 — Give Banubu the Pie',
    'ready',
    1,
    'banubu_q1_ready_1',
    [
      choiceNode('banubu_q1_ready_1', 'Oh, that smells real good. Give it here.', [
        { label: 'Give the pie.', next: 'banubu_q1_ready_2', actions: [{ type: 'banubuQuest', operation: 'turnIn', stage: 1 }] },
        { label: 'Not yet.', next: null, actions: [] },
      ]),
      textNode('banubu_q1_ready_2', 'Mmmm, mmm. So good.', 'banubu_q1_ready_3'),
      textNode('banubu_q1_ready_3', 'I think I can do it. Let me try to get up.', 'banubu_q1_ready_4'),
      textNode('banubu_q1_ready_4', 'Ah, yep. There we go. I’m up.', 'banubu_q1_ready_5'),
      textNode('banubu_q1_ready_5', 'Ha! Look at that—the Color Pools Key. I was wondering where that went. I was worried someone snatched it while I was asleep.', 'banubu_q1_ready_6'),
      textNode('banubu_q1_ready_6', 'Worst part is, they wouldn’t have even known what the key was for. I’d have been happy to let them go in there and beautify their most beloved creatures.', 'banubu_q1_ready_7'),
      textNode('banubu_q1_ready_7', 'You know what? You should have it, as a thank-you. Especially since I’m still not quite ready to help you with your problem.', 'banubu_q1_ready_8'),
      textNode('banubu_q1_ready_8', 'That pie was the perfect breakfast. Just what I needed.', 'banubu_q1_ready_9'),
      textNode('banubu_q1_ready_9', 'But after a hearty meal like that, I tend to get real tired and need to take a short nap. Short by my standards, though. Not yours, as a little mortal.', 'banubu_q1_ready_10'),
      choiceNode('banubu_q1_ready_10', '…', [
        { label: '“What?”', next: 'banubu_q1_ready_11', actions: [] },
      ]),
      textNode('banubu_q1_ready_11', 'No, no, I promise you weren’t wasting your time. A good meal and a long nap is the perfect start to a full productive day.', 'banubu_q1_ready_12'),
      choiceNode('banubu_q1_ready_12', '…', [
        { label: '“Long nap? You just said it would be a short nap.”', next: 'banubu_q1_ready_13', actions: [] },
      ]),
      textNode('banubu_q1_ready_13', 'Short? Long? Doesn’t matter. Time is an illusion. I think. Maybe. I don’t know.', 'banubu_q1_ready_14'),
      textNode('banubu_q1_ready_14', 'Yawn…', 'banubu_q1_ready_15'),
      textNode('banubu_q1_ready_15', 'I can already feel that nap coming on.', 'banubu_q1_ready_16'),
      textNode('banubu_q1_ready_16', 'All I need is a good strong bowl of Nine Leaf Tea.', 'banubu_q1_ready_17'),
      textNode('banubu_q1_ready_17', 'Here, take the recipe—and this old Tea Grinder. Each Tea Blend takes three herbs in the grinder, and the tea takes three blends plus White Milk.', 'banubu_q1_ready_18'),
      textNode('banubu_q1_ready_18', 'To get up and be truly productive, it needs to instill me with both {{banubuNextRequestedBuffs}}. And I’m a big fella, so it’s gotta be real strong. Both effects need to be {{banubuNextRequiredStrength}}.', null),
    ],
    {
      questType: 'threeFishPie',
      buffCount: 3,
      minStacks: 1,
      reward: COLOR_POOLS_KEY,
    },
  );

  const Q2_OFFER = tree(
    'banubu_q2_offer',
    'Quest 2 — Nine Leaf Tea Request',
    'offer',
    2,
    'banubu_q2_offer_1',
    [
      choiceNode('banubu_q2_offer_1', 'Zzz… Nine Leaf Tea. Three Tea Blends and White Milk. It needs {{banubuRequestedBuffs}}, with both effects {{banubuRequiredStrength}}.', [
        { label: 'I’ll make the tea.', next: 'banubu_q2_offer_2', actions: [{ type: 'banubuQuest', operation: 'accept', stage: 2 }] },
        { label: 'Let him sleep.', next: null, actions: [] },
      ]),
      textNode('banubu_q2_offer_2', 'Good. The Tea Grinder only keeps the beneficial reactions, so finding the right blends should be easier than brewing potions. Relatively speaking.', null),
    ],
    {
      questType: 'nineLeafTea',
      buffCount: 2,
      minStacks: 3,
      reward: null,
    },
  );

  const Q2_ACTIVE = tree(
    'banubu_q2_active',
    'Quest 2 — Waiting for Nine Leaf Tea',
    'active',
    2,
    'banubu_q2_active_1',
    [
      textNode('banubu_q2_active_1', 'Zzzzz… {{banubuRequestedBuffs}}… both {{banubuRequiredStrength}}… three blends… White Milk…', null),
    ],
    { questType: 'nineLeafTea', buffCount: 2, minStacks: 3, reward: null },
  );

  const Q2_READY = tree(
    'banubu_q2_ready',
    'Quest 2 — Give Banubu the Tea',
    'ready',
    2,
    'banubu_q2_ready_1',
    [
      choiceNode('banubu_q2_ready_1', 'Mmm. That smells strong enough to wake a mountain. Give it here?', [
        { label: 'Give him the Nine Leaf Tea.', next: 'banubu_q2_ready_2', actions: [{ type: 'banubuQuest', operation: 'turnIn', stage: 2 }] },
        { label: 'Not yet.', next: null, actions: [] },
      ]),
      textNode('banubu_q2_ready_2', 'Mmm…', 'banubu_q2_ready_3'),
      textNode('banubu_q2_ready_3', 'Zzzzz.', null),
    ],
    { questType: 'nineLeafTea', buffCount: 2, minStacks: 3, reward: null },
  );

  const BLOCKED_TREE = tree(
    'banubu_future_quests_blocked',
    'Quests 3–5 — Authoring Block',
    'blocked',
    3,
    'banubu_blocked_1',
    [
      textNode('banubu_blocked_1', 'Zzzzz.', null),
    ],
    { questType: 'blocked', authoringBlocked: true },
  );

  const DEFAULT_DIALOGUE_TREES = Object.freeze([
    INTRO_SLEEP_1,
    INTRO_SLEEP_2,
    INTRO_TREE,
    Q1_OFFER,
    Q1_ACTIVE,
    Q1_READY,
    Q2_OFFER,
    Q2_ACTIVE,
    Q2_READY,
    BLOCKED_TREE,
  ]);

  const STAGE_DEFAULTS = Object.freeze([
    Object.freeze({
      stage: 1,
      questType: 'threeFishPie',
      buffCount: 3,
      minStacks: 1,
      reward: COLOR_POOLS_KEY,
    }),
    Object.freeze({
      stage: 2,
      questType: 'nineLeafTea',
      buffCount: 2,
      minStacks: 3,
      reward: null,
    }),
  ]);

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value)); // Used whenever defaults enter mutable runtime/editor records.
  }

  function ensureCookingRecipes(cookingData = window.HobunjiCookingData) {
    if (!cookingData) return [];
    if (!Array.isArray(cookingData.recipes)) cookingData.recipes = [];
    if (cookingData.categoryLabels) cookingData.categoryLabels.teaBlend = 'Tea Blend'; // Used by Cooking UI for the three processed blend slots.
    const added = [];
    for (const recipe of [THREE_FISH_PIE_RECIPE, NINE_LEAF_TEA_RECIPE]) {
      if (cookingData.recipes.some(existing => existing?.id === recipe.id)) continue;
      cookingData.recipes.push(deepClone(recipe));
      added.push(recipe.id);
    }
    return added;
  }

  function mergeDialogueTreesIntoDatabase(database) {
    if (!database || !Array.isArray(database.npcs)) return database;
    const npc = database.npcs.find(entry => entry?.id === NPC_ID);
    if (!npc) return database;
    const existingQuestTrees = new Map((npc.dialogueTrees || []).filter(entry => entry?.banubuQuest).map(entry => [entry.id, entry])); // Used to retain deliberate Dialogue Editor edits while deleting generic/daily Banubu chatter.
    npc.dialogueTrees = DEFAULT_DIALOGUE_TREES.map(defaultTree => deepClone(existingQuestTrees.get(defaultTree.id) || defaultTree));
    npc.phrasePools = []; // Banubu is not a daily-greeting NPC; all authored lines live in the routed quest trees above.
    npc.events = []; // Prevents generic situational dialogue events from being reintroduced by stale starter-database content.
    return database;
  }

  window.BanubuQuestContent = Object.freeze({
    NPC_ID,
    QUEST_ID,
    RECIPE_ID: THREE_FISH_PIE_RECIPE_ID,
    THREE_FISH_PIE_RECIPE_ID,
    NINE_LEAF_TEA_RECIPE_ID,
    WAR_PAINT_KIT,
    COLOR_POOLS_KEY,
    keyItems: KEY_ITEMS,
    recipe: THREE_FISH_PIE_RECIPE,
    threeFishPieRecipe: THREE_FISH_PIE_RECIPE,
    nineLeafTeaRecipe: NINE_LEAF_TEA_RECIPE,
    stageDefaults: STAGE_DEFAULTS,
    dialogueTrees: DEFAULT_DIALOGUE_TREES,
    deepClone,
    ensureCookingRecipe: ensureCookingRecipes,
    ensureCookingRecipes,
    mergeDialogueTreesIntoDatabase,
  });

  ensureCookingRecipes();
})();
