// Friendship-gated farmhouse weapon gifts.
//
// This is intentionally data-only. Runtime queue/spawn/unlock behavior lives in
// docs/js/weapon-trust-visits.js; add another villager by adding one entry here
// and author/edit the matching dialogue tree in the Dialogue Editor.
(function (global) {
  'use strict';

  const config = {
    schema: 'hobunji_weapon_trust_visits.v1',

    relationship: {
      // DialogueContent displays positive relationship from 0..10 hearts.
      maxPositiveHearts: 10,
      // Halfway from 0 to max, rounded up. Kept explicit/configurable so a
      // future relationship-scale change does not hide the threshold in code.
      requiredHearts: 5,
    },

    visitor: {
      farmhouseInteriorArea: 'interior',
      farmhouseExteriorArea: 'farm',
      preferredDistanceFromDoorTiles: 3,
      nearestWalkableSearchRadiusTiles: 5,
      oneVisitorPerHouseExit: true,
      // Config order is queue order. A pending visitor remains at the front
      // until their trust dialogue reaches its natural end.
      queuePolicy: 'config-order',
      visitorIdPrefix: 'weapon_trust_visit:',
      completionMemoryPrefix: 'weapon_trust_gift:',
    },

    // The bronzeworks starts with the ordinary tool shapes only. Each shape
    // below is added to its craft tabs only after the matching gift dialogue
    // completes. The gifted item itself is a normal generated metal item.
    gifts: [
      {
        id: 'jubmir_bshuakauitl',
        npcId: 'jubmir',
        shapeKey: 'bshuakauitl',
        giftMetalKey: 'nativeCopper',
        dialogueTreeId: 'weapon_trust_gift_bshuakauitl',
        dialogueLabel: "Trust Gift — B'shuakauitl",
        dialogueLines: [
          "You've given me enough reasons to trust you that I wanted to come say this away from the inn.",
          "I carried this B'shuakauitl before I settled into life here. I don't pass something like it on lightly.",
          "Take it. If you ever want another made to suit a different metal, the bronzeworks can copy the shape now that you've seen how it's put together."
        ],
      },
      {
        id: 'kzubug_plainssword',
        npcId: 'kzubug',
        shapeKey: 'plainsSword',
        giftMetalKey: 'nativeCopper',
        dialogueTreeId: 'weapon_trust_gift_plainssword',
        dialogueLabel: 'Trust Gift — Plains-Sword',
        dialogueLines: [
          "I trust you enough now that I don't want this to just be another thing on the rack between us.",
          "This Plains-Sword is one I made for myself at the bronzeworks. Keeping a blade you made with your own hands means noticing every flaw and every good choice in it.",
          "It's yours. I can make the same pattern for you in other metals from now on."
        ],
      },
      {
        id: 'hreesh_kylie',
        npcId: 'hreesh',
        shapeKey: 'kylie',
        giftMetalKey: 'nativeCopper',
        dialogueTreeId: 'weapon_trust_gift_kylie',
        dialogueLabel: 'Trust Gift — Kylie',
        dialogueLines: [
          "You've become someone I can count on. I figured that deserved more than saying it across a counter.",
          "I've kept this Kylie for a long time because it was mine, not because it was valuable. That's the sort of thing that gets harder to hand away, not easier.",
          "So I'm handing it to you. Kzubug and Sloomi can work from the pattern if you ever want another."
        ],
      },
      {
        id: 'dzibim_warcleaver',
        npcId: 'dzibim',
        shapeKey: 'warCleaver',
        giftMetalKey: 'nativeCopper',
        dialogueTreeId: 'weapon_trust_gift_warcleaver',
        dialogueLabel: 'Trust Gift — War-Cleaver',
        dialogueLines: [
          "I don't give trust quickly. You managed to earn enough of it that I came all the way out here instead of pretending this wasn't important.",
          "This War-Cleaver has been mine long enough that I know the balance without looking. That's why giving it away actually means something.",
          "Keep it. The bronzeworks can make you another from the pattern after this, but this one is the one I chose to give you."
        ],
      },
      {
        id: 'gantami_dagger',
        npcId: 'gantami_ginju',
        shapeKey: 'dagger',
        giftMetalKey: 'nativeCopper',
        dialogueTreeId: 'weapon_trust_gift_dagger',
        dialogueLabel: 'Trust Gift — Dagger',
        dialogueLines: [
          "I think we're past the point where I have to wonder whether I can trust you.",
          "This dagger is one I kept for myself instead of treating it like ordinary gear. It stayed with me because it was familiar, and because familiar things matter when you're nervous.",
          "I'd like you to have it. If you need another later, the bronzeworks can reproduce the shape in whatever metal you bring them."
        ],
      },
      {
        id: 'furunji_daggersword',
        npcId: 'furunji_funji',
        shapeKey: 'daggerSword',
        giftMetalKey: 'nativeCopper',
        dialogueTreeId: 'weapon_trust_gift_daggersword',
        dialogueLabel: 'Trust Gift — Dagger-Sword',
        dialogueLines: [
          "You've been good to me and mine. At some point that stops being simple politeness and starts being trust.",
          "I've held onto this Dagger-Sword because it was one of those possessions that became part of my own history instead of just stock to buy and sell.",
          "Take it. And once Kzubug or Sloomi has the pattern in front of them, they can make the same kind of weapon for you in other metals."
        ],
      },
      {
        id: 'pahu_fishingmace',
        npcId: 'pahu',
        shapeKey: 'fishingmace',
        giftMetalKey: 'nativeCopper',
        dialogueTreeId: 'weapon_trust_gift_fishingmace',
        dialogueLabel: 'Trust Gift — Fishing Mace',
        dialogueLines: [
          "You've come far enough with me that I reckon I can trust you with something I actually use, not just something I can replace without thinking.",
          "This Fishing Mace has been with me out on the water and in the mire. A tool like this ends up carrying a lot of small memories with it.",
          "You should have it. The bronzeworks can copy the pattern after this if you want one made from a different metal."
        ],
      },
    ],

    bandits: {
      // Bandits roll these with equal shape probability. Metal tier, mastery,
      // attack choice, and damage continue to use the existing bandit/tool
      // systems; the weapon-only shapes deliberately receive no damage bonus.
      weaponShapePool: [
        'hatchet', 'fishingmace', 'fishingspear', 'pickshovel',
        'bshuakauitl', 'daggerSword', 'plainsSword', 'dagger', 'kylie', 'warCleaver'
      ],
    },

    onboarding: {
      // Only new profiles are changed; existing saves that already own the
      // old starter Fishing Mace are not retroactively stripped of it.
      removeStarterItemKeys: ['fishingmace_nativeCopper'],
    },
  };

  global.WEAPON_TRUST_VISIT_CONFIG = Object.freeze(config);
})(window);
