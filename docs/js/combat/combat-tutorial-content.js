// Spearhead's lessons share the live combat registry and Compendium terminology.
(() => {
  'use strict';
  const basics = [ // Ordered practice cards for the immediately available session.
    { id: 'resources', title: 'Three resources', text: 'My son Oddclaw will be your sparring partner. We will take this one exercise at a time. Health keeps you alive. Stamina pays for attacks and dodges. Footing keeps you upright: losing it can stagger you or knock you prone. Watch the three ground rings. Training restores your original resources when you leave.', check: 'read' },
    { id: 'swing', title: 'Swing combo', weapon: 'hatchet', ability: 'swingCombo', slot: 'tap1', check: 'hit', count: 3, goal: 'Tap Weapon Action 1 to land 3 combo hits', text: 'Walk up to Oddclaw, aim at him and tap Weapon Action 1. Time successive taps to work through the three-hit swing combo. The reticle and your aim matter; the weapon must actually reach the target.' },
    { id: 'poke', title: 'Thrust combo', weapon: 'fishingspear', ability: 'pokeCombo', slot: 'tap1', check: 'hit', count: 3, goal: 'Tap Weapon Action 1 to land 3 thrusts', text: 'This borrowed spear uses a thrust combo. Tap Weapon Action 1 and land three hits. Tap 1 always follows the weapon: you do not assign its combo in the Loadout tab.' },
    { id: 'quick', title: 'Quick attacks', ability: 'opportunistJab', slot: 'tap2', check: 'hit', goal: 'Tap Weapon Action 2 to land Opportunist Jab', text: 'Tap Weapon Action 2 for Opportunist Jab. A Quick Attack has useful conditions: this one rewards catching an enemy during its windup or strike. You can still try its ordinary hit against our stationary sparring partner. Later we will practice those conditions.' },
    { id: 'breaker', title: 'Charged Breaker', ability: 'chargedBreaker', slot: 'hold1', check: 'hit', goal: 'Hold Weapon Action 1, then release to strike', text: 'Hold Weapon Action 1 to wind up Charged Breaker, then release to strike. Give the pose time to build before releasing. Watch the Stamina ring as you hold; this is a committed heavy strike, not repeated combo taps. This is an Offensive Hold.' },
    { id: 'flurry', title: 'Accelerating Flurry', ability: 'acceleratingFlurry', slot: 'hold1', check: 'hit', count: 3, goal: 'Keep Weapon Action 1 held and land 3 strikes', text: 'Keep Weapon Action 1 held. Flurry strikes repeatedly and accelerates as you maintain it. Release to stop. Land three strikes; compare this sustained attack with Breaker’s single released strike.' },
    { id: 'counter', title: 'Counter Shield', ability: 'counterShield', slot: 'hold2', check: 'block', hostile: true, goal: 'Hold Weapon Action 2 and block one of Oddclaw’s attacks', text: 'Hold Weapon Action 2 to raise Counter Shield. Let Oddclaw attack: a successful block spends Stamina and triggers a counterattack. This is a Defensive Hold: it reacts to incoming attacks instead of charging a release.' },
    { id: 'blink', title: 'Blink Dodge', ability: 'blinkDodge', slot: 'hold2', check: 'blink', goal: 'Hold Weapon Action 2, then move to hop', text: 'Hold Weapon Action 2, then move. Blink Dodge hops on fresh movement input, builds speed during uninterrupted movement, and can hop again on a sharp reversal. It does not attack. Make one hop.' },
    { id: 'dodge', title: 'Ordinary dodge', check: 'dodge', goal: 'Press Dodge while moving', text: 'Release your weapon buttons, move away from the stairs, and press Dodge while moving. Dodging costs Stamina and briefly avoids hits. You do not need a learned defensive hold to dodge.' },
    { id: 'lunge', title: 'Aim and distance', ability: 'swingCombo', slot: 'tap1', check: 'hit', startGap: 2.5, goal: 'Close the distance, then tap Weapon Action 1 to land a hit', text: 'Face and aim at Oddclaw, then land another combo hit. Attacks lunge along your aim; aiming upward changes the jump and distance. An airborne follow-up requires a previous hit. Reposition when a target is outside your weapon’s reach.' },
    { id: 'crossbow', title: 'Crossbow basics', weapon: 'crossbow', check: 'rangedHit', goal: 'Use Weapon Action 1 to load and fire; hit Oddclaw', text: 'Try a borrowed crossbow. Weapon Action 1 runs its normal load and fire cycle. Aim at Oddclaw and land a projectile hit. Your ranged slot is separate from your melee weapon. Later ranged Mastery lessons introduce ammunition choices.' },
    { id: 'scatterbow', title: 'Scatterbow basics', weapon: 'scatterbow', check: 'rangedHit', goal: 'Use Weapon Action 1 to fire; hit Oddclaw', text: 'Now fire the scatterbow at Oddclaw. Its spread makes distance matter. These are borrowed weapons: completing training returns your original equipment.' },
    { id: 'recovery', title: 'Recovery and loadouts', check: 'read', text: 'Stop spending Stamina to give it room to recover. Pushing past normal Stamina causes Exhaustion. If Footing reaches zero, you fall prone and recover before getting up. Afflicted portions of a resource are not automatically the same as having little remaining resource. Loadout choices are saved separately for each weapon: Tap 2 is Quick, Hold 1 Offensive, and Hold 2 Offensive or Defensive. Choose one technique you tried to keep permanently.' },
  ];
  const openings = [ // Conditional attacks revisited when the Combat skill improves.
    { id: 'openings', title: 'Find the opening', check: 'read', text: 'A quick attack’s bonus depends on its condition, not just the bar’s colored segments. Exhaust Cutter cares about actual exhaustion or low remaining Stamina, Mercy Spike about low remaining Health, and Backstab Flick about attacking from behind. Effects that lower an effective maximum are accounted for by the combat system.' },
    { id: 'jab', title: 'Catch the windup', ability: 'opportunistJab', slot: 'tap2', check: 'quickBonus', hostile: true, goal: 'Tap Weapon Action 2 while Oddclaw winds up', hint: 'Watch for his windup, then strike before his blow lands.', text: 'Watch Oddclaw prepare his attack, then tap Weapon Action 2 to land Opportunist Jab during his windup or strike. Catching the windup lets you interrupt him before his hit staggers you. A normal hit will not finish this exercise.' },
    { id: 'exhaust', title: 'Exhaust Cutter', ability: 'exhaustCutter', slot: 'tap2', check: 'quickBonus', condition: 'exhausted', goal: 'Tap Weapon Action 2 to land Exhaust Cutter', text: 'This partner has been made exhausted for the exercise. Land Exhaust Cutter with Weapon Action 2. Affliction buildup alone is not the condition.' },
    { id: 'mercy', title: 'Mercy Spike', ability: 'mercySpike', slot: 'tap2', check: 'quickBonus', condition: 'lowHealth', goal: 'Tap Weapon Action 2 to land Mercy Spike', text: 'The partner’s remaining Health is low for this exercise. Land Mercy Spike with Weapon Action 2. Training attacks cannot kill him.' },
    { id: 'back', title: 'Backstab Flick', ability: 'backstabFlick', slot: 'tap2', check: 'quickBonus', goal: 'Get behind Oddclaw, then tap Weapon Action 2', hint: 'Get fully behind his back before you strike.', text: 'Circle behind Oddclaw while he stands still and use Weapon Action 2. The bonus must trigger to finish this exercise.' },
  ];
  // What each affliction a weapon can apply actually does, and why you would
  // pick it. Two demonstrations preview a real rank-1 upgrade on a borrowed
  // weapon (CombatProgression demonstration preview) so the buildup is visible.
  const afflictions = [
    { id: 'aff_read', title: 'Reading buildup', check: 'read', text: 'Colored buildup on a ring is an affliction. Health-side afflictions eat Health over time. Stamina-side afflictions punish the target for spending Stamina, or shrink how much it has. Your weapon decides which ones you can learn: sharp weapons cut, blunt weapons batter.' },
    { id: 'aff_bleed', title: 'See it: Bleeding', weapon: 'hatchet', ability: 'swingCombo', slot: 'tap1', check: 'hit', count: 2,
      preview: { kind: 'melee', rank: 1, index: 0, ability: 'swingCombo', demonstration: true },
      goal: 'Land 2 hatchet hits and watch Oddclaw’s Health ring', text: 'This hatchet is lent with Opened Wound. Land two hits, then watch his Health ring: the red Bleeding Health drains him while the fight goes on.' },
    { id: 'aff_sharp', title: 'Sharp choices', check: 'read', text: 'Bleeding Health: fast, steady damage in a long fight, but it heals back if the enemy gets away and rests. Poisoned Health: slower, never heals back on its own, and keeps working after the fight; pick it for enemies that flee or that you cannot finish. Wounded Stamina: hurts the enemy every time it attacks or dodges; best against aggressive enemies, weak against passive ones. Infected Stamina: like Wounded, and can also make them retch, leaving them winded and poisoned.' },
    { id: 'aff_winded', title: 'See it: Winded', weapon: 'fishingmace', ability: 'swingCombo', slot: 'tap1', check: 'hit', count: 2,
      preview: { kind: 'melee', rank: 1, index: 1, ability: 'swingCombo', demonstration: true },
      goal: 'Land 2 mace hits and watch Oddclaw’s Stamina ring', text: 'This mace is lent with Winding Blows. Land two hits and watch his Stamina ring shrink: Winded Stamina lowers how much Stamina he can hold.' },
    { id: 'aff_blunt', title: 'Blunt choices', check: 'read', text: 'Bruised Health: the next heavy hit deals bonus damage; pair it with Charged Breaker. Winded Stamina: less Stamina means the enemy exhausts sooner; pair it with Exhaust Cutter. Congealed Health: temporarily lowers the enemy’s maximum Health and recovers on its own, so press the advantage while it lasts. Shattered Stamina: spending through it makes the enemy start Bleeding, so it gives a blunt weapon a bleed.' },
    { id: 'aff_choose', title: 'Choosing and surviving', check: 'read', text: 'Pick afflictions for how you fight: Health-side ones for damage, Stamina-side ones for control. Stacking one affliction makes it matter faster than spreading picks thin. When they are on you: stop spending Stamina to clear Stamina-side buildup, step into water to put out Burning, and use an Antidote for toxins. The Compendium lists every affliction and its remedy.' },
  ];
  const quests = [ // Gates use permanent skill levels and actual owned-item Mastery, never food bonuses.
    { id: 'spearhead_basics', title: 'Spearhead — First Arms', combat: 0, steps: basics },
    { id: 'spearhead_afflictions', title: 'Spearhead — Afflictions', combat: 0, requires: 'spearhead_basics', steps: afflictions },
    { id: 'spearhead_openings', title: 'Spearhead — Reading an Opening', combat: 2, requires: 'spearhead_basics', steps: openings },
    { id: 'spearhead_resources', title: 'Spearhead — Staying on Your Feet', combat: 5, requires: 'spearhead_basics', steps: [
      { id: 'afflictions', title: 'Buildup and remedies', check: 'read', text: 'Afflictions are buildup on resources. Damage, Control, Offensive Debuff, and Defensive Debuff families describe their role. Some reduce an effective maximum; others punish spending an afflicted portion. Consult the Compendium’s live affliction registry for each exact effect. Restorative potions remove matching families or tags; an Antidote targets toxins, not every injury.' },
      { id: 'balance', title: 'Keep your balance', ability: 'counterShield', slot: 'hold2', hostile: true, check: 'block', goal: 'Hold Weapon Action 2 and block a strike', text: 'Block a strike while watching your Health, Stamina, and Footing. Stronger damage is not your only advantage: breaking enemy Footing can interrupt its attack. Your own prone recovery restores your chance to fight back.' },
      { id: 'movement', title: 'Make breathing room', ability: 'blinkDodge', slot: 'hold2', check: 'blink', goal: 'Hold Weapon Action 2 and move to hop clear', text: 'Use Blink Dodge to move clear, then release it. A held stance can keep costing Stamina: let go when you need recovery.' },
    ] },
  ];
  // Mastery comparison sessions (combat-tutorial-mastery.js generates their
  // trials from the equipped weapon's live upgrade choices) are no longer in
  // Spearhead's lesson menu. Other systems can still run one:
  // CombatTutorial.start(CombatTutorialContent.masteryQuestTemplate(rank, { ranged }), walker).
  function masteryQuestTemplate(rank, options = {}) {
    const ranged = options.ranged === true;
    const level = Math.max(1, Math.min(5, Math.trunc(Number(rank) || 1)));
    const prefix = ranged ? 'spearhead_ranged_' : 'spearhead_mastery_';
    const requires = level === 1 ? 'spearhead_basics' : `${prefix}${level - 1}`; // Same rank chain the menu used to enforce.
    return ranged
      ? { id: `${prefix}${level}`, title: `Spearhead — Ranged Mastery ${level}`, rangedMastery: level, requires, steps: [] }
      : { id: `${prefix}${level}`, title: `Spearhead — Mastery ${level}`, mastery: level, requires, steps: [] };
  }
  const termColors = { // Shared colors reinforce the tutorial's resource and ability categories.
    'Health': '#ff9292', 'Stamina': '#a5e894', 'Footing': '#8bd5ff',
    'Defensive Hold': '#8bd5ff', 'Defensive': '#8bd5ff', 'Counter Shield': '#8bd5ff', 'Blink Dodge': '#8bd5ff',
    'Offensive Hold': '#ffbb88', 'Offensive': '#ffbb88', 'Charged Breaker': '#ffbb88', 'Accelerating Flurry': '#ffbb88',
    'Quick Attack': '#ffe394', 'Quick': '#ffe394', 'Opportunist Jab': '#ffe394', 'Exhaust Cutter': '#ffe394', 'Mercy Spike': '#ffe394', 'Backstab Flick': '#ffe394',
    'Mastery': '#d7b4ff', 'Loadout': '#d7b4ff', 'Exhaustion': '#d7b4ff', 'Affliction': '#d7b4ff',
    'Bleeding Health': '#ff7a7a', 'Poisoned Health': '#9be37a', 'Bruised Health': '#c79bff', 'Congealed Health': '#e0a0a0', 'Burning': '#ffae5c',
    'Wounded Stamina': '#ffb38a', 'Infected Stamina': '#b9d36a', 'Winded Stamina': '#9fd8ff', 'Shattered Stamina': '#d0d0e0',
  };
  const termPattern = new RegExp('\\b(' + Object.keys(termColors).sort((a, b) => b.length - a.length).join('|') + ')(s?)\\b', 'gi'); // Longest names match first; plural forms keep the same meaning and color.
  for (const quest of quests) for (const lesson of quest.steps) {
    lesson.text = lesson.text.replace(termPattern, (match, term) => {
      const key = Object.keys(termColors).find(label => label.toLowerCase() === term.toLowerCase()); // Case-insensitive prose retains its authored spelling.
      return `[color=${termColors[key]}]${match}[/color]`;
    });
  }
  window.CombatTutorialContent = { NPC_ID: 'spearhead_unumanuk', ARENA: 'map_i_watchhouse_arena', quests, masteryQuestTemplate };
})();
