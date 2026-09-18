// Banubu fish-pie quest content shared by runtime and the Dialogue Editor.
(() => {
  'use strict';

  const global = window; // Used as the browser-global export target shared by the game and editor.
  const NPC_ID = 'banubu'; // Used to merge this authored quest content into Banubu without touching unrelated NPCs.
  const RECIPE_ID = 'banubuThreeFishPie'; // Used by cooking unlocks, quest matching, and editor diagnostics.

  const THREE_FISH_PIE_RECIPE = { // Used as the locked cooking template Banubu teaches on first conversation.
    id: RECIPE_ID,
    name: 'Three-Fish Pie',
    description: 'A Banubu-style pie made from exactly three fish. The fish determine every food buff it grants.',
    baseOutputName: 'Three-Fish Pie',
    lockedByDefault: true,
    slots: [
      { id: 'fishA', label: 'First Fish', accepts: ['fish'], required: true },
      { id: 'fishB', label: 'Second Fish', accepts: ['fish'], required: true },
      { id: 'fishC', label: 'Third Fish', accepts: ['fish'], required: true },
    ],
    outputTags: ['Meal', 'Pie', 'Fish Pie', 'Banubu'],
  };

  function questMeta(phase, stage = 0, extra = {}) { // Used to keep runtime routing metadata consistent across all authored Banubu trees.
    return { phase, stage, ...extra };
  }

  function textNode(id, text, next = null) { // Used to make compact editable dialogue line nodes below.
    return { id, type: 'text', text, next, expression: 'neutral', expressionHold: 2, revealSpeed: 'normal', tags: [] };
  }

  function endNode(id) { // Used to terminate Banubu quest dialogue trees explicitly in the editor graph.
    return { id, type: 'end', tags: [] };
  }

  function choiceNode(id, choices) { // Used to author quest accept/turn-in actions with ordinary editor-visible choice nodes.
    return { id, type: 'choice', choices, tags: [] };
  }

  function makeStageTrees(stage, reward, buffCount) { // Used to create the offer/reminder/turn-in trio for one sequential fish-pie quest.
    const prefix = `banubu_q${stage}`; // Used to keep generated node ids unique and easy to recognize in the Dialogue Editor.
    const rewardMeta = { // Used by the runtime and editor as the canonical reward/difficulty definition for this stage.
      buffCount,
      reward: { ...reward },
    };
    const offer = { // Used while this stage has not yet been accepted.
      id: `${prefix}_offer`,
      label: `Fish Pie Quest ${stage} — Offer`,
      trigger: 'quest',
      priority: 50,
      conditions: {},
      excludeConditions: {},
      banubuQuest: questMeta('offer', stage, rewardMeta),
      entryNode: `${prefix}_offer_line`,
      nodes: [
        textNode(`${prefix}_offer_line`, `For pie ${stage}, bring me a three-fish pie that grants {{banubuRequestedBuffs}}. I will trade you {{banubuRewardName}} for it.`, `${prefix}_offer_choice`),
        choiceNode(`${prefix}_offer_choice`, [
          { label: 'I’ll make it.', actions: [{ type: 'banubuQuest', operation: 'accept', stage }], next: `${prefix}_accepted` },
          { label: 'Not yet.', next: `${prefix}_offer_end` },
        ]),
        textNode(`${prefix}_accepted`, 'Good. Three fish. One pie. Do not eat the evidence.', `${prefix}_offer_end`),
        endNode(`${prefix}_offer_end`),
      ],
    };
    const active = { // Used while the player still needs to cook the requested effect combination.
      id: `${prefix}_active`,
      label: `Fish Pie Quest ${stage} — Reminder`,
      trigger: 'quest',
      priority: 50,
      conditions: {},
      excludeConditions: {},
      banubuQuest: questMeta('active', stage),
      entryNode: `${prefix}_active_line`,
      nodes: [
        textNode(`${prefix}_active_line`, 'I am still waiting for a three-fish pie that grants {{banubuRequestedBuffs}}.', `${prefix}_active_end`),
        endNode(`${prefix}_active_end`),
      ],
    };
    const ready = { // Used only when a matching cooked pie is actually present in the live inventory.
      id: `${prefix}_ready`,
      label: `Fish Pie Quest ${stage} — Turn In`,
      trigger: 'quest',
      priority: 60,
      conditions: {},
      excludeConditions: {},
      banubuQuest: questMeta('ready', stage),
      entryNode: `${prefix}_ready_line`,
      nodes: [
        textNode(`${prefix}_ready_line`, 'That smell is right. Is that my {{banubuRequestedBuffs}} pie?', `${prefix}_ready_choice`),
        choiceNode(`${prefix}_ready_choice`, [
          { label: 'Give Banubu the pie.', actions: [{ type: 'banubuQuest', operation: 'turnIn', stage }], next: `${prefix}_complete` },
          { label: 'Keep it for now.', next: `${prefix}_ready_end` },
        ]),
        textNode(`${prefix}_complete`, 'Yes. This will do. Take {{banubuRewardName}}.', `${prefix}_ready_end`),
        endNode(`${prefix}_ready_end`),
      ],
    };
    return [offer, active, ready];
  }

  const INTRO_TREE = { // Used for the first conversation and recipe unlock before the five-quest chain begins.
    id: 'banubu_fish_pie_intro',
    label: 'Three-Fish Pie Lesson',
    trigger: 'quest',
    priority: 70,
    conditions: {},
    excludeConditions: {},
    banubuQuest: questMeta('intro', 0),
    entryNode: 'banubu_intro_line',
    nodes: [
      textNode('banubu_intro_line', 'Fish are better when three of them become one pie. I can teach you the template.', 'banubu_intro_choice'),
      choiceNode('banubu_intro_choice', [
        { label: 'Teach me.', actions: [{ type: 'banubuQuest', operation: 'unlockRecipe', stage: 0 }], next: 'banubu_intro_learned' },
        { label: 'Another time.', next: 'banubu_intro_end' },
      ]),
      textNode('banubu_intro_learned', 'There. Three fish, always. Which fish you choose decides what the pie puts into your bones.', 'banubu_intro_end'),
      endNode('banubu_intro_end'),
    ],
  };

  const STAGE_DEFAULTS = [ // Used as editable starter authoring for the five sequential rewards and requested buff counts.
    { stage: 1, buffCount: 1, reward: { id: 'war_paint_kit', label: 'War-Paint Kit', scope: 'character', featureId: 'war_paint' } },
    { stage: 2, buffCount: 2, reward: { id: 'banubu_key_2', label: 'Unassigned Banubu Key II', scope: 'world', featureId: 'banubu_feature_2' } },
    { stage: 3, buffCount: 2, reward: { id: 'banubu_key_3', label: 'Unassigned Banubu Key III', scope: 'character', featureId: 'banubu_feature_3' } },
    { stage: 4, buffCount: 3, reward: { id: 'banubu_key_4', label: 'Unassigned Banubu Key IV', scope: 'world', featureId: 'banubu_feature_4' } },
    { stage: 5, buffCount: 3, reward: { id: 'banubu_key_5', label: 'Unassigned Banubu Key V', scope: 'character', featureId: 'banubu_feature_5' } },
  ];

  const FINISHED_TREE = { // Used after all five rewards have been claimed.
    id: 'banubu_fish_pie_finished',
    label: 'Fish Pie Questline — Finished',
    trigger: 'quest',
    priority: 70,
    conditions: {},
    excludeConditions: {},
    banubuQuest: questMeta('finished', 6),
    entryNode: 'banubu_finished_line',
    nodes: [
      textNode('banubu_finished_line', 'Five pies. You understand the important part now: the fish choose what the pie becomes.', 'banubu_finished_end'),
      endNode('banubu_finished_end'),
    ],
  };

  const DEFAULT_DIALOGUE_TREES = [ // Used as the source overlay; exported NPC databases can override any tree by keeping the same id.
    INTRO_TREE,
    ...STAGE_DEFAULTS.flatMap(definition => makeStageTrees(definition.stage, definition.reward, definition.buffCount)),
    FINISHED_TREE,
  ];

  function deepClone(value) { // Used to keep editor/runtime mutations from modifying this built-in fallback content.
    return JSON.parse(JSON.stringify(value));
  }

  function mergeDialogueTreesIntoDatabase(database) { // Used by runtime DB composition and Dialogue Editor loading so the full quest is authorable.
    const npc = database?.npcs?.find(entry => entry?.id === NPC_ID); // Used to scope the overlay to Banubu's existing NPC record.
    if (!npc) return database;
    npc.bio = "The Sleeping Grehlr, a Great Fey that formed in proximity to people and was shaped by their thoughts into a perpetually sleepy creature. Banubu's sleepiness is intrinsic to what he is, not a biological need; he has no ordinary waking routine, hunger cycle, or sensible mortal schedule."; // Used by NPC/lore surfaces so old hunger-based placeholder text cannot contradict the implemented fey characterization.
    npc.loreBackground = "Fey generation is a natural phenomenon: most form as mindless wisps, but those that generate near people can be shaped by nearby thoughts and ideas. Banubu became the Sleeping Grehlr and remains asleep indefinitely in his northern-cliff cavern. He teaches the Three-Fish Pie template and then asks for five pies whose exact buff combinations are drawn only from combinations the current fish catalog can actually produce."; // Used as the canonical design-note replacement for the obsolete Fifteen Fish Pie placeholder.
    npc.questHooks = [
      "First conversation teaches the locked Three-Fish Pie template.",
      "Five sequential fish-pie quests request randomized, actually craftable buff combinations.",
      "Quest 1 rewards the character-scoped War-Paint Kit; later key-item rewards remain separately authorable.",
    ]; // Used by NPC authoring/reference tools to describe the implemented quest chain instead of the obsolete fifteen-fish concept.
    if (!Array.isArray(npc.dialogueTrees)) npc.dialogueTrees = [];
    const existingIds = new Set(npc.dialogueTrees.map(tree => tree?.id).filter(Boolean)); // Used to preserve exported/user-edited trees instead of replacing them with defaults.
    for (const tree of DEFAULT_DIALOGUE_TREES) { // Used to fill only quest trees missing from the loaded database.
      if (!existingIds.has(tree.id)) npc.dialogueTrees.push(deepClone(tree));
    }
    return database;
  }

  function ensureCookingRecipe(cookingData = global.HobunjiCookingData) { // Used after cooking data loads to register one locked template without duplicating it.
    if (!cookingData || !Array.isArray(cookingData.recipes)) return false;
    if (cookingData.recipes.some(recipe => recipe?.id === RECIPE_ID)) return true;
    cookingData.recipes.push(deepClone(THREE_FISH_PIE_RECIPE));
    return true;
  }

  global.BanubuQuestContent = {
    NPC_ID,
    RECIPE_ID,
    recipe: THREE_FISH_PIE_RECIPE,
    stageDefaults: STAGE_DEFAULTS,
    dialogueTrees: DEFAULT_DIALOGUE_TREES,
    mergeDialogueTreesIntoDatabase,
    ensureCookingRecipe,
    deepClone,
  };
})();
