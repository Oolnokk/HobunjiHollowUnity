// Friendship-gated farmhouse weapon gifts.
//
// This is intentionally data-only. Runtime queue/spawn/unlock behavior lives in
// docs/js/weapon-trust-visits.js; add another villager by adding one entry here
// and author/edit the matching dialogue tree in the Dialogue Editor.
// Discovery-only weapon sources live separately in weapon-discovery-rewards.js.
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
      // Door placement / one-visitor-per-exit tuning is shared by every
      // doorstep visit and lives in js/doorstep-visits.js.
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
          'Good {{timeOfDay}}, {{playerHonorific}} {{playerName}}.',
          'I came here to thank you. Not only for being an ally in our efforts to save this village, but for being a friend.',
          'I wish you to have this...',
          "It's a B'shuakauitl, a traditional Slagothim blowgun-staff.",
          'An ingeniously simple design, it can not only dispatch enemies in close range but can also fire envenomed darts that can not only harm, but incapacitate or even heal wounded allies.',
          'When used wisely, it can turn the tide of battles.',
          'Think of this not only as a gift, but as an investment. Hobunji Hollow needs both of us.'
        ],
      },
      {
        id: 'kzubug_plainssword',
        npcId: 'kzubug',
        shapeKey: 'plainsSword',
        giftMetalKey: 'nativeCopper',
        dialogueTreeId: 'weapon_trust_gift_plainssword',
        dialogueLabel: "Trust Gift — Kzubug's Plains-Sword",
        // Full trees are supported for trust visits that need choices/branches.
        // This remains ordinary Dialogue Editor data rather than runtime logic.
        dialogueTree: {
          entryNode: 'kzubug_trust_intro',
          nodes: [
            {
              id: 'kzubug_trust_intro',
              type: 'text',
              text: 'Hey there, {{playerNickname}}. Got a moment?',
              expression: 'smile',
              expressionHold: 2,
              revealSpeed: 'normal',
              next: 'kzubug_trust_choice',
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_choice',
              type: 'choice',
              choices: [
                { label: 'Yes.', next: 'kzubug_trust_yes_good' },
                { label: 'No.', next: 'kzubug_trust_no_quick' },
              ],
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_yes_good',
              type: 'text',
              text: 'Good, good...',
              expression: 'smile',
              expressionHold: 2,
              revealSpeed: 'normal',
              next: 'kzubug_trust_yes_welcome',
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_yes_welcome',
              type: 'text',
              text: "You know, I appreciate your presence here. I'm glad you came to our little hole in the rock. So I made you a welcome gift.",
              expression: 'smile',
              expressionHold: 2,
              revealSpeed: 'normal',
              next: 'kzubug_trust_yes_sword',
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_yes_sword',
              type: 'text',
              text: "This here is a plains-sword. Up atop the Eastern Highplains, where our folk are from, it is known as a weapon of heroes. I don't get a lot of demand for them, as most folk around here, even many of our own people, find them heavy and unwieldy.",
              expression: 'neutral',
              expressionHold: 2,
              revealSpeed: 'normal',
              next: 'kzubug_trust_yes_maoao',
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_yes_maoao',
              type: 'text',
              text: "Mao'ao weapons soften arms, I say. People learn to fight using their flimsy fluttery blades, and then the moment a real weapon gets put in their hands they aren't ready for it.",
              expression: 'frown',
              expressionHold: 2,
              revealSpeed: 'normal',
              next: 'kzubug_trust_yes_hero',
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_yes_hero',
              type: 'text',
              text: "But you, I can tell that you've got the heart of a hero.",
              expression: 'smile',
              expressionHold: 2,
              revealSpeed: 'normal',
              next: 'kzubug_trust_yes_believe',
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_yes_believe',
              type: 'text',
              text: 'I believe in you...',
              expression: 'smile',
              expressionHold: 2,
              revealSpeed: 'slow',
              next: null,
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_no_quick',
              type: 'text',
              text: "Ah well, I'll make it quick then.",
              expression: 'neutral',
              expressionHold: 2,
              revealSpeed: 'normal',
              next: 'kzubug_trust_no_gift',
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_no_gift',
              type: 'text',
              text: "I'm happy you settled down here, so I decided to make you a special weapon. It's called a plains-sword. I think you might be among the few with the strength to wield such a weapon, so I felt it was my duty as a smith to put one in your hands. Here...",
              expression: 'smile',
              expressionHold: 2,
              revealSpeed: 'normal',
              next: 'kzubug_trust_no_business',
              tags: [{ type: 'weapon_trust_gift' }],
            },
            {
              id: 'kzubug_trust_no_business',
              type: 'text',
              text: "I'll let you get back to your own business, now.",
              expression: 'neutral',
              expressionHold: 2,
              revealSpeed: 'normal',
              next: null,
              tags: [{ type: 'weapon_trust_gift' }],
            },
          ],
        },
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
          "I wasn't born around here, you know. I grew up in Khannibarr-krassin, north up into the Eastern Highplains, and as far west as you could possibly go. Down a mountain's height of stairs, deep into a burning savannah, and up another into the snowy towerwood forests of the Western Highplains.",
          "There stands the Great Stone City, the capital of the entire Khannibarri Empire. A place of fortune and prosperity. And I grew up with neither.",
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
        id: 'pahu_grapple_flail',
        npcId: 'pahu',
        shapeKey: 'grappleFlail',
        giftMetalKey: 'tinBronze', // The original flail Pahu kept from his pirate days is this unique tin-bronze weapon.
        giftItemKey: 'grappleFlail', // Give his actual authored relic; the smith will make separately generated metal variants afterward.
        dialogueTreeId: 'weapon_trust_gift_grapple_flail',
        dialogueLabel: "Trust Gift — Pahu's Grapple-Flail",
        dialogueLines: [
          "Ahoy, <lad/lass>, good to see you.\nWanted to talk to you about somethin that been on moy moind.",
          "Oy don't know if ye noticed, but me and moy sweet Leaf arr gettin quoite old. Soon Leaf'll be gone, and though oym sure oy'll have a few yearrs left boy moy lonesome after that, toime just moves so fast, it does.",
          "Don't remember if oy told you this, yet, but loyk most of moy fellow Rakako'ans, oy spent moy youth on the hoygh seas. And loike a fair portion of them, oy was one of them Rakako'ans keepin' ohp one of our oldest traditions. The one that in truth defoines us. Rakako'an tradition demands we wearr the patch so long as we keep to the code. But oy was one of them young kenkarri livin in the way of he who wrote it. Oy was a poyrate.",
          "Though moy days of poyracy are so very long behoynd me, for whatever reason oy still held on to me most trusty arrm from those days this whole toym. The one that beat a fairr amount of beligerant merchants within an inch of death, and a small few royght to it, --- though purely boy accident oy assurre you.",
          "Moy Grapple Flail.",
          "Ain't no good in moy hands, hasn't been forr most of moy loife to be honest. And trohst me, that's a long toime.\nThough in your hands, oym sure it will. She's almost as old as oy am, but trust me, she'll always be devastatin' in a foight.",
          "Oy'll tell ya, <lad/lass>, ye've been growin' on me quoyt a bit. Ye've got wind behoind yerr back, gettin' ohp, doin' somethin. Remoinds me of meself.",
          "To be honest oy was certain oy'd be dead beforre she'd foind herself in someone else's talons. Know that me givin herr to you willin'ly, that means alot.",
          // The shared prefix and species-dependent suffix stay in one spoken sentence.
          // Only players who are not Rakako'an hear the extra affirmation first.
          "{{playerSpeciesIf:rakakoan||Ya know, <lad/lass>, bein' a Rakako'an ain't really about where yer from, its about who you are. Yerr values. What's in yer heart.\n\n}}Keep impressin' me and oy moight let you in on{{playerSpeciesIf:rakakoan| somethin' useful you may have forrgot about.| a well kept Rakako'an secret. One that'll knock you on yerr arse. Heh heh.}}"
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
    ],

    bandits: {
      // Bandits roll these with equal shape probability. Metal tier, mastery,
      // attack choice, and damage continue to use the existing bandit/tool
      // systems; the weapon-only shapes deliberately receive no damage bonus.
      weaponShapePool: [
        'workhammer', 'hatchet', 'fishingmace', 'fishingspear', 'pickshovel',
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
