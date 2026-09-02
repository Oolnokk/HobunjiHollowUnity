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
        dialogueLabel: "Trust Gift — Hreesh's Kylies",
        dialogueLines: [
          "Good {{timeOfDay}}, {{playerName}}. I decided to close the tavern for a moment so I could talk to you about something. So please listen.",
          "In my line of work I see lots of people come and go from this little nook of ours. I'm glad you came, and even happier that you didn't go.",
          "I wasn't born around here, you know. I grew up in Khanibarr-krassin, north up into the Eastern Highplains, and as far west as you could possibly go. Down a mountain's height of stairs, deep into a burning savannah, and up another into the snowy towerwood forests of the Western Highplains.",
          "There stands the Great Stone City, the capital of the entire Khanibarri Empire. A place of fortune and prosperity. And I grew up with neither.",
          "My parents died in the plague of '22. Same one that took Kzubug's wife and kids. So I grew up with nothing, and nobody. Nobody unaffiliated with the Thug's Guild, that is.",
          "In order to eat I stole, and often in order to steal, I had no choice but to fight. And the Thug's Guild gave me the tools I needed to do that. These.",
          "They're called kylies. They say the Tembarri use them for hunting giant birds down in the Low Plains. We used them for beating innocent people within an inch of their lives and clobbering anyone who thought they could make a run for it.",
          "I've never killed anyone, but it weren't out of mercy. I've never killed because a dead man couldn't go out and make the bronze he owed us.",
          "Eventually that stuff caught up with me. I ended up spending half my life locked away in the city's massive, dark, and inescapable dungeon. When I got out, I knew I had to start over somewhere else, so I went to the only 'somewhere else' I knew anything about. Hobunji Hollow.",
          "Both my parents grew up here, fell in love together here. They used to tell us all kinds of stories about this place.",
          "I set up my little inn here in my parents' old house. Before I showed up, the place was nothing but broken boards and cobwebs. Visitors just stayed with whoever had an extra bed.",
          "But now I've got a place here. A purpose. But as I said, I'm always seeing people come and go, and I always have. And I thought I always would.",
          "But I have this gut feeling that you're not going anywhere. That you're someone I can actually rely on.",
          "I used to feel that the only things I could rely on were those kylies. But I don't feel that way anymore. I want you to have them.",
          "I'm sure they'll serve you better than they ever served me."
        ],
      },
      {
        id: 'dzibim_warcleaver',
        npcId: 'dzibim_khibu',
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
      // Only newly-created characters lose the old starter Fishing Mace.
      // Existing characters keep whatever they already own, including when
      // they start/join another world.
      removeStarterItemKeys: ['fishingmace_nativeCopper'],
      newCharacterCreationToleranceMs: 5000,
    },
  };

  global.WEAPON_TRUST_VISIT_CONFIG = Object.freeze(config);
})(window);
