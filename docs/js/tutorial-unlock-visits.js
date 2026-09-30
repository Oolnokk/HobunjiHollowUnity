// Spearhead drops by the farmhouse door when a new combat lesson unlocks.
//
// A DoorstepVisits provider (see js/doorstep-visits.js): lesson gates stay
// owned by CombatTutorial.gate; this file only notices which gated lessons
// have opened since the player was last told, and remembers the ones already
// announced via DoorstepVisits.markDone (saved per character per world).
// All lessons that opened at once are announced together in one visit.
(function (global) {
  'use strict';

  const doorstep = global.DoorstepVisits;
  const content = global.CombatTutorialContent;
  const tutorial = global.CombatTutorial;
  if (!doorstep || !content || !tutorial) {
    console.warn('[tutorial-unlock-visits] DoorstepVisits/CombatTutorial missing; tutorial visits disabled');
    return;
  }

  const TREE_ID = 'doorstep_tutorial_unlock';
  const flagKey = quest => `tutorial_unlock:${quest.id}`;

  function family(quest) {
    return quest.mastery ? 'mastery' : quest.rangedMastery ? 'rangedMastery' : null;
  }

  // Mirrors CombatTutorial.selectTree's menu: each Mastery family only ever
  // offers its next incomplete rank, so only that rank can be "new".
  function offered(quest) {
    const key = family(quest);
    if (!key) return true;
    const ranks = content.quests.filter(other => other[key]);
    const next = ranks.find(other => tutorial.questState?.(other.id)?.status !== 'completed');
    return quest === next;
  }

  function newlyUnlocked(quest) {
    if (!quest.requires && !(quest.combat > 0) && !family(quest)) return false; // Open from the very first visit; nothing to announce.
    if (doorstep.isDone(flagKey(quest))) return false;
    const status = tutorial.questState?.(quest.id)?.status;
    if (status && status !== 'not_started') return false; // Already found it on their own.
    if (!offered(quest)) return false;
    try { return tutorial.gate(quest) === ''; }
    catch (_) { return false; } // Gates read live equipment/progress deps that do not exist before game.js initializes CombatTutorial.
  }

  function lessonName(quest) {
    return String(quest.title || quest.id).replace(/^Spearhead\s+—\s+/, '');
  }

  function joinNames(names) {
    if (names.length <= 1) return names[0] || '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  function buildTree(quests) {
    const names = quests.map(quest => `[color=#ffe394]${lessonName(quest)}[/color]`);
    const lines = [
      'Good {{timeOfDay}}, {{playerHonorific}}. I was passing and hoped to catch you.',
      quests.length === 1
        ? `You have earned a new lesson: ${names[0]}.`
        : `You have earned some new lessons: ${joinNames(names)}.`,
      'Come find me at the watchhouse whenever you wish to begin.',
    ];
    const nodes = lines.map((text, index) => ({
      id: `${TREE_ID}_line_${index + 1}`,
      type: 'text',
      text,
      expression: index === 1 ? 'smile' : 'neutral',
      expressionHold: 2,
      revealSpeed: 'normal',
      next: index + 1 < lines.length ? `${TREE_ID}_line_${index + 2}` : null,
    }));
    return { id: TREE_ID, label: 'Doorstep — New Lesson', trigger: 'interact', priority: 99, visibility: 'any', entryNode: nodes[0].id, nodes };
  }

  function next() {
    const quests = content.quests.filter(newlyUnlocked);
    if (!quests.length) return null;
    return {
      key: `tutorial_unlock:${quests.map(quest => quest.id).join('+')}`,
      npcId: content.NPC_ID,
      tree: buildTree(quests),
      questIds: quests.map(quest => quest.id),
    };
  }

  function onComplete(visit) {
    const byId = new Map(content.quests.map(quest => [quest.id, quest]));
    for (const id of (visit?.questIds || [])) {
      const quest = byId.get(id);
      if (quest) doorstep.markDone(flagKey(quest));
    }
    return true;
  }

  doorstep.registerProvider({ id: 'tutorial_unlock', priority: 50, next, onComplete });

  global.TutorialUnlockVisits = Object.freeze({ next, newlyUnlocked, buildTree });
})(window);
