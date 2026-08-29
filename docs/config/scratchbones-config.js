window.SCRATCHBONES_CONFIG = {
  // WebSocket relay URL for online multiplayer.
  // Set this to your ngrok (or other public) address when running remotely,
  // or remove / comment it out to fall back to ws://localhost:8080 for local dev.
  // Example: wsUrl: 'wss://mustang-walk-schematic.ngrok-free.dev',
  wsUrl: 'wss://mustang-walk-schematic.ngrok-free.dev',


  // Global clothing color tuning offsets.
  clothingHueOffset: 29,
  clothingSatOffset: 0,
  clothingLightOffset: 0,

  game: {
    // Shared presentation settings for the Character Studio avatar editor.
    // Body-color ranges themselves remain species data under config/species.
    "avatarEditor": {
      "bodyColorSwatchColumns": 7,
      "bodyColorSwatchRows": 4
    },
    "creatureGenetics": {
      "defaultPatternChance": 0.3333333333333333,
      "patternChances": { "grehlr": { "mitts": 0.08 } },
      // Base/pattern colors flow from makeDefaultGenotype through breeding and
      // CreatureGeneticsRender. Drenkirra deliberately use an equally weighted
      // bright, full-hue parrot palette rather than the default earthy coats.
      "palettes": {
        "default": [
          {id:'soot-brown',name:'Soot Brown',hex:'#5b4c43',weight:4},{id:'charcoal',name:'Charcoal',hex:'#55585c',weight:4},
          {id:'blue-grey',name:'Blue Grey',hex:'#596879',weight:4},{id:'ash',name:'Ash',hex:'#6d7068',weight:4},
          {id:'dove',name:'Dove Grey',hex:'#756f78',weight:4},{id:'warm-grey',name:'Warm Grey',hex:'#74685f',weight:4},
          {id:'olive-grey',name:'Olive Grey',hex:'#6d7058',weight:4},{id:'pale-cream',name:'Pale Cream',hex:'#c8b991',weight:4},
          {id:'cream',name:'Cream',hex:'#c7aa77',weight:4},{id:'champagne',name:'Champagne',hex:'#b99a72',weight:4},
          {id:'biscuit',name:'Biscuit',hex:'#bd9463',weight:4},{id:'sand',name:'Sand',hex:'#b28754',weight:4},
          {id:'buff',name:'Buff',hex:'#b77c49',weight:2},{id:'honey',name:'Honey',hex:'#b97832',weight:2},
          {id:'golden',name:'Golden',hex:'#ae8430',weight:2},{id:'fawn',name:'Fawn',hex:'#a47650',weight:4},
          {id:'taupe',name:'Taupe',hex:'#806a5b',weight:4},{id:'mushroom',name:'Mushroom',hex:'#77635b',weight:4},
          {id:'sable',name:'Sable',hex:'#714c37',weight:4},{id:'seal-brown',name:'Seal Brown',hex:'#5e493c',weight:4},
          {id:'chocolate',name:'Chocolate',hex:'#6a412e',weight:4},{id:'liver',name:'Liver',hex:'#65403d',weight:4},
          {id:'chestnut',name:'Chestnut',hex:'#894e31',weight:1},{id:'mahogany',name:'Mahogany',hex:'#784337',weight:4},
          {id:'cinnamon',name:'Cinnamon',hex:'#a45b37',weight:2},{id:'russet',name:'Russet',hex:'#994b30',weight:1},
          {id:'auburn',name:'Auburn',hex:'#874438',weight:1},{id:'copper',name:'Copper',hex:'#a85e3a',weight:2},
          {id:'fox-red',name:'Fox Red',hex:'#b15d30',weight:1},{id:'rosy-beige',name:'Rosy Beige',hex:'#997267',weight:4},
          {id:'lilac-grey',name:'Lilac Grey',hex:'#746775',weight:4},{id:'black-brown',name:'Black-Brown',hex:'#4f3f36',weight:4},
        ],
        "drenkirra": [
          {id:'scarlet',name:'Scarlet',hex:'#ef3340',weight:1},{id:'tangerine',name:'Tangerine',hex:'#ff7a18',weight:1},
          {id:'sun-yellow',name:'Sun Yellow',hex:'#ffd629',weight:1},{id:'lime',name:'Lime',hex:'#8bdc24',weight:1},
          {id:'parrot-green',name:'Parrot Green',hex:'#20c65a',weight:1},{id:'turquoise',name:'Turquoise',hex:'#19c7c1',weight:1},
          {id:'sky-blue',name:'Sky Blue',hex:'#2e9cff',weight:1},{id:'cobalt',name:'Cobalt',hex:'#3558e8',weight:1},
          {id:'violet',name:'Violet',hex:'#873de0',weight:1},{id:'magenta',name:'Magenta',hex:'#e638a7',weight:1},
          {id:'coral',name:'Coral',hex:'#ff6675',weight:1},{id:'orchid',name:'Orchid',hex:'#c965e8',weight:1},
        ]
      }
    },
    // Wildlife reproduction and farm-livestock data. Den mothers are
    // selected only from species actually native to the den's exterior zone.
    "wildlife": {
      // World-space widths consumed by CREATURE_DB; kept separate from farm
      // display widths so either context can be tuned without code changes.
      "creatureModelWidths": { "drenkirra": 0.82, "drenkirra-den-mother": 1.16 },
      "denMothers": {
        "gar-wolf": { "creatureKey": "gar-wolf-den-mother", "nestItemKey": "garWolfBaby" },
        "uumkaoii-wild": { "creatureKey": "uumkaoii-wild-den-mother", "nestItemKey": "uumkaoiiEgg" },
        "grehlr": { "creatureKey": "grehlr-den-mother", "nestItemKey": "grehlrBaby" },
        "drenkirra": { "creatureKey": "drenkirra-den-mother", "nestItemKey": "fertileDrenkirraEgg" }
      },
      "nestClutch": { "min": 1, "max": 3 }
    },
    "livestock": {
      "itemKinds": {
        "uumkaoiiCrate": "uumkaoii", "uumkaoiiEgg": "uumkaoii",
        "garWolfBaby": "gar-wolf", "dabinggiHoundEgg": "dabinggi-hound",
        "grehlrBaby": "grehlr", "fertileDrenkirraEgg": "drenkirra"
      },
      "animalWidths": { "gar-wolf": 1.9, "dabinggi-hound": 1.7, "grehlr": 2.2, "drenkirra": 0.82 },
      // Diet classification, used by barn troughs to decide which fodder
      // (plantFodder/meatFodder) a housed animal will actually eat —
      // predator: meatFodder only, prey: plantFodder only, omnivore: either.
      "diet": {
        "uumkaoii": "prey",
        "gar-wolf": "predator",
        "dabinggi-hound": "predator",
        "grehlr": "omnivore",
        "drenkirra": "prey"
      },
      "resources": {
        "uumkaoii": { "itemKey": "uumkaoiiEgg", "cooldownDays": 2 },
        "gar-wolf": { "itemKey": "garWolfMilk", "cooldownDays": 1, "verb": "Milk", "interactive": true },
        "dabinggi-hound": { "itemKey": "dabinggiHoundVenom", "cooldownDays": 1, "verb": "Milk", "interactive": true },
        "grehlr": { "itemKey": "grehlrStinkOil", "cooldownDays": 1, "verb": "Extract", "interactive": true },
        "drenkirra": { "itemKey": "drenkirraEgg", "cooldownDays": 1 }
      }
    },
    "debug": {
      "enabled": true,
      "includeConsoleDebug": true,
      "eventLogLimit": 400,
      "trace": {
        "gameplayFlow": true,
        "layerPromotion": false,
        "audio": true,
        "candlelight": false,
        "actions": true
      }
    },
    "inventory": {
      "clothingSprites": {
        "rugged_poncho": "assets/cosmetics/clothes/overwear/portrait/poncho1_mao_m.png",
        "fine_poncho": "assets/cosmetics/clothes/overwear/portrait/poncho1_mao_m.png",
        "fine_hood": "assets/cosmetics/clothes/hood/finehood-base_m.png",
        "facewrap": "assets/cosmetics/clothes/hood/facewrap_m.png",
        "tankan_tunic": "assets/cosmetics/clothes/torso/portrait/tankantunic_mao-ao_m.png",
        "bandolier1": "assets/cosmetics/clothes/torso/portrait/bandolier1_mao-ao_m.png",
        "appearance::hat::basic_headband": "assets/cosmetics/clothes/hat/headband.png",
        "appearance::hat::leather_headband": "assets/cosmetics/clothes/hat/headband.png",
        "appearance::hat::riverlandskasa_wide": "assets/cosmetics/clothes/hat/riverlandskasa_wide-front.png"
      }
    },
    "movement": {
      "perpRotDeadzoneDeg": 40,
      "creaturePerpRotDeadzoneDeg": 27.5,
      "npc": {
        "speedTilesPerSecond": 1.25,
        "endpointPauseSeconds": 1.6,
        "arrivalRadiusTiles": 0.18,
        "interactionRadiusTiles": 2.0,
        "routeSnapRadiusTiles": 8,
        "beelineSampleStepTiles": 0.25
      }
    },
    "npcDialogue": {
      "text": {
        "maxCharsPerPage": 180,
        "emptyLine": "...",
        "typewriter": {
          "enabled": true,
          "msPerChar": 22,
          "punctuationPauseMs": 120,
          "whitespacePauseMs": 0
        }
      },
      "portrait": {
        "maxFps": 12,
        "yap": {
          "flashMs": 120,
          "spaceDelayMs": 60,
          "pauseDelayMs": 250
        }
      },
      "staging": {
        "playerDiagonalOffsets": [
          { "x": -0.5, "y": 1 },
          { "x": 0.5, "y": 1 }
        ],
        "moveSpeedTilesPerSecond": 4.25,
        "arrivalRadiusTiles": 0.08,
        "faceLerp": 0.28,
        "npcFacePlayerLerp": 0.28
      }
    },
    "camera": {
      "defaultMode": "default",
      "dialogueMode": "npcDialogue",
      "modes": {
        "default": {
          "distanceTiles": 14,
          "angleFromGroundDeg": 32.73,
          "fovDeg": 42,
          "followLerp": 0.08,
          "targetYOffsetTiles": 0
        },
        "npcDialogue": {
          "distanceTiles": 4.67,
          "angleFromGroundDeg": 10.64,
          "fovDeg": 42,
          "followLerp": 0.18,
          "targetYOffsetTiles": 0.9,
          "alignToDialoguePortraitCenters": true,
          "portraitCenterMinDistanceTiles": 0.001,
          "maxUpwardPortraitPitchDeg": 0,
          "runtimeZoom": {
            "enabled": true,
            "initialPercent": 75,
            "minPercent": 0,
            "maxPercent": 100,
            "maxZoomFactor": 2.5,
            "wheelSensitivity": 0.0015,
            "pinchSensitivity": 1,
            "resetOnDialogueClose": false
          }
        },
        "fishing": {
          "distanceTiles": 11.475,
          "angleFromGroundDeg": 25.5,
          "azimuthDeg": 34,
          "fovDeg": 42,
          "followLerp": 0.15,
          "targetYOffsetTiles": 0.35
        },
        "fishCatch": {
          "distanceTiles": 7,
          "angleFromGroundDeg": 13,
          "azimuthDeg": 0,
          "fovDeg": 42,
          "followLerp": 0.15,
          "targetYOffsetTiles": 0.9
        },
        "music": {
          "distanceTiles": 8.5,
          "angleFromGroundDeg": 20,
          "azimuthDeg": 28,
          "fovDeg": 42,
          "followLerp": 0.12,
          "targetYOffsetTiles": 0.55
        },
        "harvestInteraction": {
          "distanceTiles": 6,
          "angleFromGroundDeg": 16,
          "fovDeg": 42,
          "followLerp": 0.15,
          "targetYOffsetTiles": 0.55
        },
        "seated": {
          "distanceTiles": 4,
          "angleFromGroundDeg": 14,
          "fovDeg": 42,
          "followLerp": 0.18,
          "targetYOffsetTiles": 0,
          "freeRotate": true
        },
        "shoulderSurf": {
          "distanceTiles": 2.6,
          "angleFromGroundDeg": 9,
          "fovDeg": 55,
          "followLerp": 0.16,
          "targetYOffsetTiles": 0.62,
          "freeRotate": true
        }
      }
    },
    "desktopControls": {
      "tapWindowMs": 350,
      "cameraRotateDegPerPx": 0.15,
      "cameraRotateClampDeg": 45,
      "wheelZoomStep": 0.05,
      "wheelZoomMin": 0.75,
      "wheelZoomMax": 2.5
    },
    "input": {
      "storageKey": "scratchbones.inputBindings.v1",
      "gamepadDeadzone": 0.24,
      "axisPressThreshold": 0.55,
      "targeting": {
        "orbitRadiusTiles": 0.62,
        "inputAimDeadzone": 0.08
      },
      "actions": [
        { "id": "interact", "label": "Interact", "desktop": "KeyE", "controller": "Button0" },
        { "id": "dodge", "label": "Dodge", "desktop": "KeyX", "controller": "Button1" },
        { "id": "action1", "label": "Tool/Item Action 1", "desktop": "Space", "controller": "RightTrigger" },
        { "id": "action2", "label": "Tool/Item Action 2", "desktop": "KeyQ", "controller": "LeftTrigger" },
        { "id": "action3", "label": "Tool/Item Action 3", "desktop": "KeyR", "controller": "Button2" },
        { "id": "action4", "label": "Tool/Item Action 4", "desktop": "Enter", "controller": "Button3" },
        { "id": "action5", "label": "Tool/Item Action 5", "desktop": "Digit7", "controller": "Button12" },
        { "id": "action6", "label": "Tool/Item Action 6", "desktop": "Digit8", "controller": "Button9" },
        { "id": "action7", "label": "Tool/Item Action 7", "desktop": "Digit9", "controller": "Button14" },
        { "id": "action8", "label": "Tool/Item Action 8", "desktop": "Digit0", "controller": "Button15" },
        { "id": "swapTarget", "label": "Swap Target", "desktop": "KeyG", "controller": "Button5" },
        { "id": "meleeTargetPrev", "label": "Melee Auto-Target: Previous", "desktop": null, "controller": "RightStickLeft" },
        { "id": "meleeTargetNext", "label": "Melee Auto-Target: Next", "desktop": null, "controller": "RightStickRight" },
        { "id": "toggleMount", "label": "Call/Dismiss Mount", "desktop": "KeyV", "controller": "Button13" },
        { "id": "weaponSwitch", "label": "Swap Melee / Ranged", "desktop": "Digit3", "controller": "Button11" },
        { "id": "toolSelect", "label": "Tool Select", "desktop": "KeyT", "controller": "Button10" },
        { "id": "itemPrev", "label": "Previous Item", "desktop": "Comma", "controller": null },
        { "id": "itemNext", "label": "Next Item", "desktop": "Period", "controller": null },
        { "id": "toolPrev", "label": "Previous Tool", "desktop": "BracketLeft", "controller": null },
        { "id": "toolNext", "label": "Next Tool", "desktop": "BracketRight", "controller": null },
        { "id": "tool1", "label": "Tool 1: Shovel", "desktop": "Digit1", "controller": null },
        { "id": "tool2", "label": "Tool 2: Hoe", "desktop": "Digit2", "controller": null },
        { "id": "tool4", "label": "Tool 4: Axe", "desktop": "Digit4", "controller": null },
        { "id": "tool5", "label": "Tool 5: Pick", "desktop": "Digit5", "controller": null },
        { "id": "tool6", "label": "Tool 6: Harpoon", "desktop": "Digit6", "controller": null }
      ],
      "modeShifts": [
        { "id": "desktop-q", "label": "Desktop Held Q", "device": "desktop", "button": "KeyQ", "bindings": { "WheelUp": "itemPrev", "WheelDown": "itemNext" } },
        { "id": "desktop-e", "label": "Desktop Held E", "device": "desktop", "button": "KeyE", "bindings": { "WheelUp": "toolPrev", "WheelDown": "toolNext" } },
        { "id": "controller-left-bumper", "label": "Controller Held LB", "device": "controller", "button": "Button4", "bindings": { "RightStickLeft": "toolPrev", "RightStickRight": "toolNext", "RightStickUp": "itemPrev", "RightStickDown": "itemNext" } }
      ]
    },
    "combat": {
      "autoTargetRangeTiles": 5.5,
      // 'cut' is the base every weapon-tool ability (combo, flurry, charged
      // breaker, counter shield) scales its own damageMul off of (see
      // combat-combo.js) — tuned down from 14/24 so a starting Native Copper
      // tool's 3-hit combo, even with every mastery level chosen, doesn't
      // one-combo a Gar-wolf (38 HP): a fresh copper combo lands ~21 total,
      // a fully-mastered copper combo ~25, leaving room for metal tier
      // (0.90-1.20x) and mastery (+15-25%) to matter without early trash
      // mobs evaporating in one combo — and leaving headroom under the
      // player's ceiling for tougher threats to come later underground.
      "weaponAbilities": {
        "cut": { "damage": 6, "halfConeDeg": 18, "rangeTiles": 2.0, "staminaCost": 12, "knockbackPxS": 720, "trailHalfWidthTiles": 0.38, "trailFarTiles": 2.0, "trailMaxAgeSeconds": 0.24 },
        "slash": { "damage": 10, "halfConeDeg": 62, "rangeTiles": 2.4, "staminaCost": 20, "knockbackPxS": 1040, "trailHalfWidthTiles": 1.35, "trailFarTiles": 2.4, "trailMaxAgeSeconds": 0.34 }
      },
      "weaponTrailLimit": 5,
      "resourceSystem": {
        "quietSeconds": 3,
        "staminaRegenPerSec": 14,
        "healthRegenPerSec": 1.2,
        "afflictionRecoveryPerSec": 3.6,
        "bleedTickPerSec": 5,
        "poisonTickPerSec": 1.8,
        "exhaustionRegenPerSec": 24,
        "pukeChancePerSec": 0.16,
        "footingMax": 100,
        "footingRegenPerSec": 6,
        "proneRecoveryDelayS": 1.5
      },
      // Every landed, non-lethal hit causes a full interrupt and stagger.
      // The lockout is normally only baseDurationSeconds, then approaches
      // maxDurationSeconds as remaining Footing approaches
      // maxDurationAtFootingFraction (1 Footing on the default 100-point
      // resource). See game.js's applyHitStagger. Impact clips are retimed to
      // this gameplay duration rather than making differently authored
      // directions stun for different lengths.
      "stagger": {
        "baseDurationSeconds": 0.1,
        "maxDurationSeconds": 1,
        "maxDurationAtFootingFraction": 0.01,
        "footingLossPerDamage": 1.6,
        "damageTypeMultipliers": {
          "blunt": {
            "healthDamage": 0.75,
            "footingDamage": 1.25
          }
        }
      },
      "combatConeReticle": {
        "enabled": true,
        "color": "#ffffff",
        "alpha": 0.11,
        "lineWidth": 2,
        "lineDash": [8, 7]
      },
      "cuttableTargetGlow": {
        "enabled": true,
        "color": "#ff2a1f",
        "alpha": 0.42
      }
    },
    "gameplayShortcuts": {
      "focusChat": {
        "enabled": true,
        "key": "Enter",
        "selectExistingText": true
      }
    },
    "mobileControls": {
      "npcDialogueButton": {
        "icon": "💬",
        "label": "Talk",
        "action": "npc_dialogue",
        "style": "primary",
        "noTargetMessage": "No one nearby to talk to."
      },
      "generalStoreButton": {
        "icon": "🛒",
        "label": "Shop",
        "action": "open_general_store",
        "style": "primary",
        "npcIds": ["furunji_funji", "foroji_funji"],
        "stationLabels": ["Sitting at Counter", "Checking Shelves"],
        "noTargetMessage": "Find Foroji or Furunji at the general store counter or shelves to shop.",
        "shopGreeting": "What can I do for you?",
        "buyChoiceLabel": "Buy",
        "chatChoiceLabel": "Chat"
      },
      "carpenterButton": {
        "icon": "🪚",
        "label": "Carpenter",
        "action": "open_carpenter_shop",
        "style": "primary",
        "npcIds": ["dzibim_khibu"],
        "stationLabels": ["Carpentry Work"],
        "noTargetMessage": "Find Dzibim at the carpenter's counter to buy barn plans.",
        "shopGreeting": "Looking to build something?",
        "buyChoiceLabel": "Buy",
        "chatChoiceLabel": "Chat"
      },
      "actionArch": {
        "radiusClamp": { "minPx": 200, "vmin": 36, "maxPx": 260 },
        "cssVar": "--scratchbones-action-arch-radius"
      },
      "outerArch": {
        "radiusClamp": { "minPx": 300, "vmin": 54, "maxPx": 390 },
        "cssVar": "--scratchbones-outer-arch-radius"
      },
      "safeMarginPx": 18
    },
    "chat": {
      "messageMaxLength": 180,
      "inputFocusFontSizePx": 16,
      "blurInputOnSubmit": true,
      "resetMobileZoomOnSubmit": true,
      "mobileZoomResetDelayMs": 60,
      "mobileZoomResetViewportContent": "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      "messageBubbleSpawnAfterZoomResetMs": 0,
      "messageAnimationSpawnAfterZoomResetMs": 0,
      "laughPhrases": ["lol", "ha", "haha", "hahaha"],
      "cussWords": ["damn", "hell", "ass", "arse", "crap", "shit", "fuck", "bitch", "bastard", "piss", "cunt", "cock", "dick", "pussy", "bollocks", "shite"],
      "bubbleMaxLength": 36,
      "bubbleDurationMs": 5000,
      "bubbleOverlayZIndex": 10030
    },
    "deck": {
      "rankCount": 10,
      "copiesPerRank": 4,
      "handSize": 10,
      "wildCount": 10,
      "playerCount": 4,
      "humanNames": [
        "You"
      ]
    },

    "lobby": {
      "modes": [
        { "id": "pvpve", "label": "PvPvE", "desc": "Online: 1+ Human + AI fill", "humanRange": null },
        { "id": "pve", "label": "PvE", "desc": "Offline vs AI", "humanRange": null },
        { "id": "pvp", "label": "PvP", "desc": "Online: All Human players", "humanRange": [2, 4] }
      ]
    },

    "appearanceEditor": {
      "shopCatalog": [
        { "id": "facewrap", "label": "Facewrap", "price": 60, "category": "hood", "description": "A close-wrapped hood that conceals the lower face.", "material": "cloth" }
      ],
      "availability": {
        "tletingan": {
          "genders": ["male", "female"],
          "randomizableGenders": ["male", "female"]
        }
      },
      "species": {
        "tletingan": {
          "female": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Tletingan_F::tl_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Tletingan_F::tl_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Tletingan_F::tl_longponytail", "label": "Long Ponytail" },
                { "id": "appearance::Tletingan_F::tl_splayedknot", "label": "Splayed Knot" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Tletingan_F::tl_shoulder_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Tletingan_F::tl_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Tletingan_F::tl_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Tletingan_F::tl_braid-L", "label": "Braid (Left)" }
              ]}
            ]
          }
        },
        "engh-sho": {
          "label": "Engh-sho",
          "genders": ["male", "female"],
          "swatchBase": "#c7d2d5",
          "male": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "Default" },
                { "id": "appearance::Mao-ao_M::mao-ao_tuft", "label": "Tuft" },
                { "id": "appearance::Mao-ao_M::mao-ao_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Mao-ao_M::mao-ao_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_splayedknot_medium", "label": "Splayed Knot" },
                { "id": "appearance::Mao-ao_M::mao-ao_long_ponytail", "label": "Long Ponytail" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_shoulder_length_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Mao-ao_M::mao-ao_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Mao-ao_M::mao-ao_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_braid-L", "label": "Braid (Left)" }
              ]},
              { "slot": "eyes", "label": "Eyes", "options": [
                { "id": "appearance::Engh-sho_M::engh_snowgoggles", "label": "Snow Goggles" }
              ]},
              { "slot": "facialHair", "label": "Facial Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_wildbeard", "label": "Wild Beard" }
              ]}
            ],
            "colorOptions": [
              { "label": "Earth",   "h": -70,  "s": -0.80, "v": -0.55 },
              { "label": "Olive",   "h": -40,  "s": -0.70, "v": -0.45 },
              { "label": "Sage",    "h":   0,  "s": -0.70, "v": -0.30 },
              { "label": "Seafoam", "h":  30,  "s": -0.60, "v": -0.15 },
              { "label": "Ash",     "h":  10,  "s": -0.90, "v":  0.25 },
              { "label": "Onyx",    "h":   0,  "s": -0.90, "v": -0.85 },
              { "label": "Brown",   "h": -113, "s": -0.45, "v": -0.45 },
              { "label": "Rust",    "h": -143, "s": -0.40, "v": -0.40 },
              { "label": "Amber",   "h": -113, "s": -0.35, "v": -0.25 },
              { "label": "Ochre",   "h":  -83, "s": -0.45, "v": -0.20 },
              { "label": "Lichen",  "h":  -23, "s": -0.55, "v": -0.25 },
              { "label": "Slate",   "h":   77, "s": -0.75, "v": -0.20 }
            ]
          },
          "female": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "Default" },
                { "id": "appearance::Mao-ao_F::mao-ao_tuft", "label": "Tuft" },
                { "id": "appearance::Mao-ao_F::mao-ao_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Mao-ao_F::mao-ao_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_splayedknot_medium", "label": "Splayed Knot" },
                { "id": "appearance::Mao-ao_F::mao-ao_long_ponytail", "label": "Long Ponytail" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_shoulder_length_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Mao-ao_F::mao-ao_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Mao-ao_F::mao-ao_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_braid-L", "label": "Braid (Left)" }
              ]},
              { "slot": "eyes", "label": "Eyes", "options": [
                { "id": "appearance::Engh-sho_F::engh_snowgoggles", "label": "Snow Goggles" }
              ]}
            ],
            "colorOptions": [
              { "label": "Earth",   "h": -70,  "s": -0.80, "v": -0.55 },
              { "label": "Olive",   "h": -40,  "s": -0.70, "v": -0.45 },
              { "label": "Sage",    "h":   0,  "s": -0.70, "v": -0.30 },
              { "label": "Seafoam", "h":  30,  "s": -0.60, "v": -0.15 },
              { "label": "Ash",     "h":  10,  "s": -0.90, "v":  0.25 },
              { "label": "Onyx",    "h":   0,  "s": -0.90, "v": -0.85 },
              { "label": "Brown",   "h": -113, "s": -0.45, "v": -0.45 },
              { "label": "Rust",    "h": -143, "s": -0.40, "v": -0.40 },
              { "label": "Amber",   "h": -113, "s": -0.35, "v": -0.25 },
              { "label": "Ochre",   "h":  -83, "s": -0.45, "v": -0.20 },
              { "label": "Lichen",  "h":  -23, "s": -0.55, "v": -0.25 },
              { "label": "Slate",   "h":   77, "s": -0.75, "v": -0.20 }
            ]
          }
        },
        "mashtzarr": {
          "label": "Mashtzarr",
          "genders": ["male", "female"],
          "bodyTintMode": "shadeFill",
          "male": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_tuft", "label": "Tuft" },
                { "id": "appearance::Mao-ao_M::mao-ao_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Mao-ao_M::mao-ao_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_splayedknot_medium", "label": "Splayed Knot" },
                { "id": "appearance::Mao-ao_M::mao-ao_long_ponytail", "label": "Long Ponytail" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_shoulder_length_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Mao-ao_M::mao-ao_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Mao-ao_M::mao-ao_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_braid-L", "label": "Braid (Left)" }
              ]},
              { "slot": "facialHair", "label": "Facial Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mashtzarr_M::mashtz_wildbeard", "label": "Wild Beard" }
              ]}
            ],
            "colorOptions": [
              { "label": "Earth",   "h": -70,  "s": -0.80, "v": -0.55 },
              { "label": "Olive",   "h": -40,  "s": -0.70, "v": -0.45 },
              { "label": "Sage",    "h":   0,  "s": -0.70, "v": -0.30 },
              { "label": "Seafoam", "h":  30,  "s": -0.60, "v": -0.15 },
              { "label": "Ash",     "h":  10,  "s": -0.90, "v":  0.25 },
              { "label": "Onyx",    "h":   0,  "s": -0.90, "v": -0.85 },
              { "label": "Brown",   "h": -113, "s": -0.45, "v": -0.45 },
              { "label": "Rust",    "h": -143, "s": -0.40, "v": -0.40 },
              { "label": "Amber",   "h": -113, "s": -0.35, "v": -0.25 },
              { "label": "Ochre",   "h":  -83, "s": -0.45, "v": -0.20 },
              { "label": "Lichen",  "h":  -23, "s": -0.55, "v": -0.25 },
              { "label": "Slate",   "h":   77, "s": -0.75, "v": -0.20 }
            ]
          },
          "female": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_tuft", "label": "Tuft" },
                { "id": "appearance::Mao-ao_F::mao-ao_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Mao-ao_F::mao-ao_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_splayedknot_medium", "label": "Splayed Knot" },
                { "id": "appearance::Mao-ao_F::mao-ao_long_ponytail", "label": "Long Ponytail" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_shoulder_length_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Mao-ao_F::mao-ao_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Mao-ao_F::mao-ao_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_braid-L", "label": "Braid (Left)" }
              ]}
            ],
            "colorOptions": [
              { "label": "Earth",   "h": -70,  "s": -0.80, "v": -0.55 },
              { "label": "Olive",   "h": -40,  "s": -0.70, "v": -0.45 },
              { "label": "Sage",    "h":   0,  "s": -0.70, "v": -0.30 },
              { "label": "Seafoam", "h":  30,  "s": -0.60, "v": -0.15 },
              { "label": "Ash",     "h":  10,  "s": -0.90, "v":  0.25 },
              { "label": "Onyx",    "h":   0,  "s": -0.90, "v": -0.85 },
              { "label": "Brown",   "h": -113, "s": -0.45, "v": -0.45 },
              { "label": "Rust",    "h": -143, "s": -0.40, "v": -0.40 },
              { "label": "Amber",   "h": -113, "s": -0.35, "v": -0.25 },
              { "label": "Ochre",   "h":  -83, "s": -0.45, "v": -0.20 },
              { "label": "Lichen",  "h":  -23, "s": -0.55, "v": -0.25 },
              { "label": "Slate",   "h":   77, "s": -0.75, "v": -0.20 }
            ]
          }
        }
      }
    },

    "trickBones": {
      "defaultUnlocked": ["smuggle", "trap", "punish"],
      "defaultLoadout": ["smuggle", "trap", "punish", "smuggle", "trap", "punish"],
      "loadoutSize": 6,
      "summaryDisplay": {
        "glyphSizePx": 14,
        "multiplyGlyphScale": 0.75,
        "gapPx": 6,
        "rowGapPx": 4,
        "marginTopPx": 6,
        "maxWidthPx": 220,
        "fontSizeRem": 0.68,
        "letterSpacingEm": 0.05,
        "seatAmountFontSize": "160%",
        "deckAmountFontSize": "250%",
        "seatAmountColumnMinEm": 1.2,
        "deckAmountColumnMinEm": 1.5,
        "amountFontFamily": "'KhymeryyanRomanLetters+Numbers', Inter, system-ui, sans-serif",
        "seatColor": "#fff",
        "deckColor": "#fff",
        "arrowText": "\u00A0",
        "glyphFilter": "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.55))",
        "deckGlyphFilter": "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.55))",
        "multiplyGlyphFilter": "brightness(0) invert(1) drop-shadow(0 1px 2px rgba(0,0,0,0.55))"
      },
      "definitions": {
        "smuggle": {
          "id": "smuggle",
          "label": "Smuggle Bone",
          "description": "When your Smuggle claim passes without challenge, its non-Smuggle claimed cards leave the table and go into another player's hand; human Smuggle users choose the target seat.",
          "wild": false
        },
        "trap": {
          "id": "trap",
          "label": "Trap Bone",
          "description": "If your challenged Trap claim is truthful and the challenge fails, transfer up to the claim size from your hand to the challenger; human defenders choose cards with state.trapSelection.",
          "wild": true
        },
        "punish": {
          "id": "punish",
          "label": "Punish Bone",
          "description": "During challenge betting, the challenger may arm Punish before opening, raising, or calling. Arming consumes one Punish card; if the challenge succeeds, the challenger gives claim-size cards to the challenged player.",
          "wild": false
        }
      },
      "npcArchetypes": [
        { "id": "balanced", "weight": 3, "loadoutWeights": { "smuggle": 1, "trap": 1, "punish": 1 } },
        { "id": "trickster", "weight": 2, "loadoutWeights": { "smuggle": 2, "trap": 2, "punish": 1 } },
        { "id": "enforcer", "weight": 2, "loadoutWeights": { "smuggle": 1, "trap": 1, "punish": 2 } }
      ]
    },
    "nameGeneration": {
      "defaultCultureId": "mao_ao",
      "seedPrefix": "madiao-player",
      "aiCultureSelection": {
        "usePortraitSpeciesCulture": true,
        "fallbackCultureId": "mao_ao",
        "speciesToCultureId": {
          "mao_ao": "mao_ao",
          "mao-ao": "mao_ao",
          "kenkari": "kenkari",
          "rakakoan": "kenkari",
          "tletingan": "slagothim",
          "engh_sho": "engh_sho",
          "engh-sho": "engh_sho"
        }
      },
      "cultures": {
        "mao_ao": {
          "id": "mao_ao",
          "displayName": "Mao-ao",
          "casing": "title",
          "birthRules": {
            "surnameFromParent": false,
            "maleFirstInitialMatchesSurnameFirstLetter": true
          },
          "marriageRules": {
            "wifeTakesHusbandSurname": true,
            "wifePrefixesHusbandFirstInitial": true
          },
          "positionedSyllables": {
            "pools": {
              "consonants": ["w", "r", "t", "y", "p", "s", "f", "g", "h", "j", "b", "n", "m", "k", "d"],
              "clusters": ["sh", "hy", "br", "dr", "fr", "gr", "pr", "sr", "shr", "tr"],
              "vowels": ["a", "e", "i", "o", "u", "ai", "ao"],
              "diphthongs": ["ai", "ao"]
            },
            "firstName": {
              "syllables": { "min": 3, "max": 3 },
              "first": {
                "female": { "patterns": ["V", "Vn", "Vng"] },
                "male": { "patterns": ["CV", "CVn", "CVng", "CVr"] }
              },
              "middle": {
                "female": { "patterns": ["CV", "CVn"] },
                "male": { "patterns": ["CV", "CVn", "CVr"] }
              },
              "last": {
                "male": { "patterns": ["jei", "ji", "jo", "CV{e}", "CV{i}", "CV{o}", "CV{u}", "CV{ai}"] },
                "female": { "patterns": ["CV{a}", "CV{i}", "CV{ai}"] }
              },
              "conditionalLast": {}
            },
            "lastName": {
              "syllables": { "exact": 2 },
              "deriveFromFirstNameMaleRules": true
            }
          }
        },
        "kenkari": {
          "id": "kenkari",
          "displayName": "Kenkari",
          "casing": "title",
          "kenkariRules": {
            "phonology": {
              "consonants": ["b", "g", "h", "k", "m", "n", "p", "r", "t"],
              "consonantWeights": { "b": 1, "g": 7, "h": 7, "k": 11, "m": 10, "n": 10, "p": 8, "r": 8, "t": 8 },
              "finalConsonantWeights": { "b": 1, "g": 4, "h": 3, "k": 12, "m": 12, "n": 13, "p": 5, "r": 3, "t": 4 },
              "postGlottalFinalConsonantWeights": { "b": 1, "g": 3, "h": 2, "k": 12, "m": 12, "n": 14, "p": 3, "r": 1, "t": 2 },
              "vowels": ["a", "e", "i", "o", "u", "ai", "ey"],
              "vowelWeights": { "a": 11, "e": 4, "i": 11, "o": 8, "u": 10, "ai": 4, "ey": 4 },
              "finalVowelWeights": { "a": 12, "i": 13, "o": 4, "u": 11, "ai": 5, "ey": 0, "ao": 5 },
              "finalOnlyVowels": ["ao"],
              "minPhonemes": 2,
              "maxPhonemes": 4,
              "templateWeights": [
                { "pattern": ["V", "'V", "CV"], "weight": 18, "label": "V'CV" },
                { "pattern": ["CV", "'V"], "weight": 18, "label": "CV'V" },
                { "pattern": ["CV", "CV"], "weight": 18, "label": "CVCV" },
                { "pattern": ["CV", "'V", "CV"], "weight": 16, "label": "CV'VCV" },
                { "pattern": ["CV", "CV", "CV"], "weight": 12, "label": "CVCVCV" },
                { "pattern": ["V", "'V", "CV", "CV"], "weight": 8, "label": "V'VCVCV" }
              ]
            },
            "surnameRules": {
              "malePrefix": "ao",
              "femalePrefix": "u"
            }
          }
        },
        "slagothim": {
          "id": "slagothim",
          "displayName": "Slagothim",
          "casing": "title",
          "slagothimRules": {
            "locations": ["Ikinga", "Bahangi", "Hatonga", "Rahingi", "B'bonga", "Niringi", "Ununga", "Gorungi"],
            "firstConsonants": ["b", "g", "n", "p", "t", "d", "k", "m", "sl", "shr", "tr", "gr", "br", "gl"],
            "firstConsonantClusters": ["sl", "shr", "tr", "gr", "br", "gl"],
            "vowels": ["a", "e", "i", "o", "u"],
            "secondConsonants": ["b", "g", "p", "t", "d", "k", "r", "n", "ng"],
            "rareSecondConsonantCluster": "mn",
            "maleSlOnlyEndings": ["o", "u"],
            "femaleSlOnlyEndings": ["a", "i"],
            "maleSuffix": "mir",
            "femaleSuffix": "mira",
            "startWithSlChance": 0.58,
            "slNameUsesSuffixChance": 0.2,
            "optionalBridgeVowelChance": 0.55,
            "mnClusterChance": 0.08
          }
        },
        "engh_sho": {
          "id": "engh_sho",
          "displayName": "Engh-sho",
          "casing": "title",
          "enghShoRules": {
            "firstNameWordList": [
              "acorn", "ael", "aestel", "amber", "amethyst", "awl", "bar", "barb", "bead", "bean",
              "bell", "beryl", "billet", "bit", "blade", "bladelet", "blank", "block", "bodkin", "bone",
              "borer", "boss", "brad", "brooch", "buckle", "bud", "burin", "burr", "button", "cake",
              "carnelian", "catch", "catchplate", "chalcedony", "chape", "chisel", "chip", "clasp",
              "coil", "coin", "comb", "cone", "core", "counter", "cramp", "crucible", "crystal", "cube",
              "cup", "cupel", "cylinder", "die", "disc", "dowel", "drop", "dyse", "earring", "emerald",
              "eyelet", "farthing", "ferrule", "file", "firestone", "flan", "flint", "fork", "garnet",
              "gem", "gim", "gimstan", "gouge", "grain", "graver", "hasp", "hinge", "hobnail", "hone",
              "hook", "hring", "husk", "hwirfel", "ingot", "jasper", "jewel", "kernel", "key", "knife",
              "knob", "knucklebone", "lamp", "leaf", "link", "lock", "lodestone", "loop", "matrix",
              "mirror", "mount", "naegl", "nail", "needle", "nut", "obol", "onyx", "opal", "peg",
              "pendant", "pening", "penny", "pin", "pinhead", "pip", "pit", "plaque", "plug", "pod",
              "point", "preon", "probe", "punch", "quartz", "reed", "rind", "ring", "rivet", "rod",
              "root", "roundel", "ruby", "sapphire", "sceat", "sceatt", "scraper", "seed", "shell",
              "sherd", "shuttle", "sliver", "socket", "spatula", "spindle", "spinel", "spool", "spoon",
              "sprig", "stalk", "stan", "stem", "sticca", "stone", "stud", "styca", "stylus", "tablet",
              "tack", "tag", "tally", "terminal", "tessera", "thimble", "thorn", "tip", "toggle",
              "token", "tooth", "tube", "twig", "wedge", "weight", "whetstone", "whorl", "wire"
            ],
            "firstNameGenderRules": {
              "maleReplacements": {
                "amber": "gold-resin",
                "amethyst": "purple-stone",
                "barb": "sharp-point",
                "beryl": "green-gem",
                "crystal": "clear-stone",
                "emerald": "green-jewel",
                "jewel": "fine-gem",
                "opal": "milk-gem",
                "ruby": "red-gem",
                "sapphire": "blue-gem"
              },
              "femaleReplacements": {
                "brad": "small-nail",
                "bud": "new-leaf",
                "jasper": "spotted-stone",
                "stan": "grey-stone"
              }
            },
            "surname": {
              "syllables": { "min": 2, "max": 3 },
              "onsetConsonants": ["n", "m", "k", "t", "p", "l", "w", "y", "h"],
              "onsetWeights": { "n": 16, "m": 13, "k": 13, "t": 13, "p": 11, "l": 5, "w": 4, "y": 4, "h": 4 },
              "vowelOnsetChance": 0.1,
              "vowels": ["a", "u", "i"],
              "vowelWeights": { "a": 20, "u": 16, "i": 4 },
              "midCodas": ["k", "n", "p"],
              "midCodaChance": 0.5,
              "finalPlosives": ["k", "p", "t", "b", "d", "g", "kk", "pp", "tt", "nk", "mp", "nt", "lk", "rk"],
              "finalPlosiveWeights": {
                "k": 22, "p": 14, "t": 8,
                "b": 2, "d": 2, "g": 2,
                "kk": 10, "pp": 6, "tt": 4,
                "nk": 10, "mp": 6, "nt": 5, "lk": 4, "rk": 4
              }
            }
          }
        }
      }
    },
    "account": {
      "bronzePassiveMax": 30,
      "bronzePassiveRateMs": 300000,
      "shopCatalog": [
        { "id": "appearance::hat::basic_headband",       "label": "Basic Headband",        "price": 35, "category": "hat",      "description": "A simple cloth headband." },
        { "id": "appearance::hat::leather_headband",     "label": "Leather Headband",      "price": 40, "category": "hat",      "description": "A sturdy leather headband.", "material": "leather" },
        { "id": "appearance::hat::riverlandskasa_low",   "label": "Riverland Kasa (Low)",  "price": 45, "category": "hat",      "description": "Traditional riverland hat, worn low.", "material": "rigid_fiber", "dyeGroup": "cloth" },
        { "id": "appearance::hat::riverlandskasa_tight", "label": "Riverland Kasa (Tight)", "price": 45, "category": "hat",      "description": "Traditional riverland hat, tight fit.", "material": "rigid_fiber", "dyeGroup": "cloth" },
        { "id": "appearance::hat::riverlandskasa_wide",  "label": "Riverland Kasa (Wide)", "price": 45, "category": "hat",      "description": "Traditional riverland hat, wide brim.", "material": "rigid_fiber", "dyeGroup": "cloth" },
        { "id": "appearance::Kenkari_M::kenk_riverlandskasa_low",  "label": "Kenkari Kasa (Low)",  "price": 45, "category": "hat", "species": "kenkari", "gender": "male",   "description": "Kenkari riverland hat, worn low.", "material": "rigid_fiber", "dyeGroup": "cloth" },
        { "id": "appearance::Kenkari_F::kenk_riverlandskasa_low",  "label": "Kenkari Kasa (Low)",  "price": 45, "category": "hat", "species": "kenkari", "gender": "female", "description": "Kenkari riverland hat, worn low.", "material": "rigid_fiber", "dyeGroup": "cloth" },
        { "id": "appearance::Kenkari_M::kenk_riverlandskasa_wide", "label": "Kenkari Kasa (Wide)", "price": 45, "category": "hat", "species": "kenkari", "gender": "male",   "description": "Kenkari riverland hat, wide brim.", "material": "rigid_fiber", "dyeGroup": "cloth" },
        { "id": "appearance::Kenkari_F::kenk_riverlandskasa_wide", "label": "Kenkari Kasa (Wide)", "price": 45, "category": "hat", "species": "kenkari", "gender": "female", "description": "Kenkari riverland hat, wide brim.", "material": "rigid_fiber", "dyeGroup": "cloth" },
        { "id": "appearance::Kenkari_M::kenk_bowlkasa", "label": "Kenkari Bowl-Kasa", "price": 55, "category": "hat", "species": "kenkari", "gender": "male", "description": "A carved wooden bowl-kasa fitted for Kenkari horns.", "material": "wood" },
        { "id": "appearance::Kenkari_F::kenk_bowlkasa", "label": "Kenkari Bowl-Kasa", "price": 55, "category": "hat", "species": "kenkari", "gender": "female", "description": "A carved wooden bowl-kasa fitted for Kenkari horns.", "material": "wood" },
        { "id": "appearance::Kenkari_M::kenk_bowlkasa", "label": "Kenkari Bowl-Kasa", "price": 55, "category": "hat", "species": "rakakoan", "gender": "male", "description": "A carved wooden bowl-kasa fitted for Kenkari horns.", "material": "wood" },
        { "id": "appearance::Kenkari_F::kenk_bowlkasa", "label": "Kenkari Bowl-Kasa", "price": 55, "category": "hat", "species": "rakakoan", "gender": "female", "description": "A carved wooden bowl-kasa fitted for Kenkari horns.", "material": "wood" },
        { "id": "tankan_tunic",     "label": "Tankan Tunic",      "price": 50, "category": "torso",    "description": "A fitted tankan-style tunic." },
        { "id": "bandolier1",       "label": "Bandolier",         "price": 40, "category": "torso",    "description": "A rugged leather bandolier.", "material": "leather" },
        { "id": "tankan_bodywrap",  "label": "Tankan Body Wrap",  "price": 60, "category": "overwear", "description": "A wrapped ceremonial bodywrap." },
        { "id": "rugged_poncho", "label": "Rugged Poncho", "price": 70, "category": "overwear", "description": "A reinforced poncho layered with a rugged body wrap.", "material": "cloth" },
        { "id": "fine_poncho", "label": "Fine Poncho", "price": 80, "category": "overwear", "description": "A finely trimmed cloth poncho.", "material": "cloth" },
        { "id": "fine_hood",        "label": "Fine Hood",         "price": 60, "category": "hood",     "description": "A finely crafted hood with trim." }
      ]
    },
    "dyes": {
      "swatchBase": "#7dc89a",
      // Mystery dye purchases use this single config value through ScratchbonesAccount.
      "mysteryDyePrice": 35,
      "hueFamilies": [
        { "id": "red", "label": "Red", "abbreviation": "R", "hueAngle": 0 },
        { "id": "red_orange", "label": "Red-Orange", "abbreviation": "R/O", "hueAngle": 15 },
        { "id": "orange", "label": "Orange", "abbreviation": "O", "hueAngle": 30 },
        { "id": "yellow_orange", "label": "Yellow-Orange", "abbreviation": "O/Y", "hueAngle": 45 },
        { "id": "yellow",    }
        }
      },
      "combatConeReticle": {
        "enabled": true,
        "color": "#ffffff",
        "alpha": 0.11,
        "lineWidth": 2,
        "lineDash": [8, 7]
      },
      "cuttableTargetGlow": {
        "enabled": true,
        "color": "#ff2a1f",
        "alpha": 0.42
      }
    },
    "gameplayShortcuts": {
      "focusChat": {
        "enabled": true,
        "key": "Enter",
        "selectExistingText": true
      }
    },
    "mobileControls": {
      "npcDialogueButton": {
        "icon": "💬",
        "label": "Talk",
        "action": "npc_dialogue",
        "style": "primary",
        "noTargetMessage": "No one nearby to talk to."
      },
      "generalStoreButton": {
        "icon": "🛒",
        "label": "Shop",
        "action": "open_general_store",
        "style": "primary",
        "npcIds": ["furunji_funji", "foroji_funji"],
        "stationLabels": ["Sitting at Counter", "Checking Shelves"],
        "noTargetMessage": "Find Foroji or Furunji at the general store counter or shelves to shop.",
        "shopGreeting": "What can I do for you?",
        "buyChoiceLabel": "Buy",
        "chatChoiceLabel": "Chat"
      },
      "carpenterButton": {
        "icon": "🪚",
        "label": "Carpenter",
        "action": "open_carpenter_shop",
        "style": "primary",
        "npcIds": ["dzibim_khibu"],
        "stationLabels": ["Carpentry Work"],
        "noTargetMessage": "Find Dzibim at the carpenter's counter to buy barn plans.",
        "shopGreeting": "Looking to build something?",
        "buyChoiceLabel": "Buy",
        "chatChoiceLabel": "Chat"
      },
      "actionArch": {
        "radiusClamp": { "minPx": 200, "vmin": 36, "maxPx": 260 },
        "cssVar": "--scratchbones-action-arch-radius"
      },
      "outerArch": {
        "radiusClamp": { "minPx": 300, "vmin": 54, "maxPx": 390 },
        "cssVar": "--scratchbones-outer-arch-radius"
      },
      "safeMarginPx": 18
    },
    "chat": {
      "messageMaxLength": 180,
      "inputFocusFontSizePx": 16,
      "blurInputOnSubmit": true,
      "resetMobileZoomOnSubmit": true,
      "mobileZoomResetDelayMs": 60,
      "mobileZoomResetViewportContent": "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
      "messageBubbleSpawnAfterZoomResetMs": 0,
      "messageAnimationSpawnAfterZoomResetMs": 0,
      "laughPhrases": ["lol", "ha", "haha", "hahaha"],
      "cussWords": ["damn", "hell", "ass", "arse", "crap", "shit", "fuck", "bitch", "bastard", "piss", "cunt", "cock", "dick", "pussy", "bollocks", "shite"],
      "bubbleMaxLength": 36,
      "bubbleDurationMs": 5000,
      "bubbleOverlayZIndex": 10030
    },
    "deck": {
      "rankCount": 10,
      "copiesPerRank": 4,
      "handSize": 10,
      "wildCount": 10,
      "playerCount": 4,
      "humanNames": [
        "You"
      ]
    },

    "lobby": {
      "modes": [
        { "id": "pvpve", "label": "PvPvE", "desc": "Online: 1+ Human + AI fill", "humanRange": null },
        { "id": "pve", "label": "PvE", "desc": "Offline vs AI", "humanRange": null },
        { "id": "pvp", "label": "PvP", "desc": "Online: All Human players", "humanRange": [2, 4] }
      ]
    },

    "appearanceEditor": {
      "shopCatalog": [
        { "id": "facewrap", "label": "Facewrap", "price": 60, "category": "hood", "description": "A close-wrapped hood that conceals the lower face.", "material": "cloth" }
      ],
      "availability": {
        "tletingan": {
          "genders": ["male", "female"],
          "randomizableGenders": ["male", "female"]
        }
      },
      "species": {
        "tletingan": {
          "female": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Tletingan_F::tl_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Tletingan_F::tl_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Tletingan_F::tl_longponytail", "label": "Long Ponytail" },
                { "id": "appearance::Tletingan_F::tl_splayedknot", "label": "Splayed Knot" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Tletingan_F::tl_shoulder_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Tletingan_F::tl_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Tletingan_F::tl_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Tletingan_F::tl_braid-L", "label": "Braid (Left)" }
              ]}
            ]
          }
        },
        "engh-sho": {
          "label": "Engh-sho",
          "genders": ["male", "female"],
          "swatchBase": "#c7d2d5",
          "male": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "Default" },
                { "id": "appearance::Mao-ao_M::mao-ao_tuft", "label": "Tuft" },
                { "id": "appearance::Mao-ao_M::mao-ao_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Mao-ao_M::mao-ao_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_splayedknot_medium", "label": "Splayed Knot" },
                { "id": "appearance::Mao-ao_M::mao-ao_long_ponytail", "label": "Long Ponytail" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_shoulder_length_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Mao-ao_M::mao-ao_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Mao-ao_M::mao-ao_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_braid-L", "label": "Braid (Left)" }
              ]},
              { "slot": "eyes", "label": "Eyes", "options": [
                { "id": "appearance::Engh-sho_M::engh_snowgoggles", "label": "Snow Goggles" }
              ]},
              { "slot": "facialHair", "label": "Facial Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_wildbeard", "label": "Wild Beard" }
              ]}
            ],
            "colorOptions": [
              { "label": "Earth",   "h": -70,  "s": -0.80, "v": -0.55 },
              { "label": "Olive",   "h": -40,  "s": -0.70, "v": -0.45 },
              { "label": "Sage",    "h":   0,  "s": -0.70, "v": -0.30 },
              { "label": "Seafoam", "h":  30,  "s": -0.60, "v": -0.15 },
              { "label": "Ash",     "h":  10,  "s": -0.90, "v":  0.25 },
              { "label": "Onyx",    "h":   0,  "s": -0.90, "v": -0.85 },
              { "label": "Brown",   "h": -113, "s": -0.45, "v": -0.45 },
              { "label": "Rust",    "h": -143, "s": -0.40, "v": -0.40 },
              { "label": "Amber",   "h": -113, "s": -0.35, "v": -0.25 },
              { "label": "Ochre",   "h":  -83, "s": -0.45, "v": -0.20 },
              { "label": "Lichen",  "h":  -23, "s": -0.55, "v": -0.25 },
              { "label": "Slate",   "h":   77, "s": -0.75, "v": -0.20 }
            ]
          },
          "female": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "Default" },
                { "id": "appearance::Mao-ao_F::mao-ao_tuft", "label": "Tuft" },
                { "id": "appearance::Mao-ao_F::mao-ao_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Mao-ao_F::mao-ao_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_splayedknot_medium", "label": "Splayed Knot" },
                { "id": "appearance::Mao-ao_F::mao-ao_long_ponytail", "label": "Long Ponytail" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_shoulder_length_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Mao-ao_F::mao-ao_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Mao-ao_F::mao-ao_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_braid-L", "label": "Braid (Left)" }
              ]},
              { "slot": "eyes", "label": "Eyes", "options": [
                { "id": "appearance::Engh-sho_F::engh_snowgoggles", "label": "Snow Goggles" }
              ]}
            ],
            "colorOptions": [
              { "label": "Earth",   "h": -70,  "s": -0.80, "v": -0.55 },
              { "label": "Olive",   "h": -40,  "s": -0.70, "v": -0.45 },
              { "label": "Sage",    "h":   0,  "s": -0.70, "v": -0.30 },
              { "label": "Seafoam", "h":  30,  "s": -0.60, "v": -0.15 },
              { "label": "Ash",     "h":  10,  "s": -0.90, "v":  0.25 },
              { "label": "Onyx",    "h":   0,  "s": -0.90, "v": -0.85 },
              { "label": "Brown",   "h": -113, "s": -0.45, "v": -0.45 },
              { "label": "Rust",    "h": -143, "s": -0.40, "v": -0.40 },
              { "label": "Amber",   "h": -113, "s": -0.35, "v": -0.25 },
              { "label": "Ochre",   "h":  -83, "s": -0.45, "v": -0.20 },
              { "label": "Lichen",  "h":  -23, "s": -0.55, "v": -0.25 },
              { "label": "Slate",   "h":   77, "s": -0.75, "v": -0.20 }
            ]
          }
        },
        "mashtzarr": {
          "label": "Mashtzarr",
          "genders": ["male", "female"],
          "bodyTintMode": "shadeFill",
          "male": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_tuft", "label": "Tuft" },
                { "id": "appearance::Mao-ao_M::mao-ao_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Mao-ao_M::mao-ao_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_splayedknot_medium", "label": "Splayed Knot" },
                { "id": "appearance::Mao-ao_M::mao-ao_long_ponytail", "label": "Long Ponytail" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_shoulder_length_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Mao-ao_M::mao-ao_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Mao-ao_M::mao-ao_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_M::mao-ao_braid-L", "label": "Braid (Left)" }
              ]},
              { "slot": "facialHair", "label": "Facial Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mashtzarr_M::mashtz_wildbeard", "label": "Wild Beard" }
              ]}
            ],
            "colorOptions": [
              { "label": "Earth",   "h": -70,  "s": -0.80, "v": -0.55 },
              { "label": "Olive",   "h": -40,  "s": -0.70, "v": -0.45 },
              { "label": "Sage",    "h":   0,  "s": -0.70, "v": -0.30 },
              { "label": "Seafoam", "h":  30,  "s": -0.60, "v": -0.15 },
              { "label": "Ash",     "h":  10,  "s": -0.90, "v":  0.25 },
              { "label": "Onyx",    "h":   0,  "s": -0.90, "v": -0.85 },
              { "label": "Brown",   "h": -113, "s": -0.45, "v": -0.45 },
              { "label": "Rust",    "h": -143, "s": -0.40, "v": -0.40 },
              { "label": "Amber",   "h": -113, "s": -0.35, "v": -0.25 },
              { "label": "Ochre",   "h":  -83, "s": -0.45, "v": -0.20 },
              { "label": "Lichen",  "h":  -23, "s": -0.55, "v": -0.25 },
              { "label": "Slate",   "h":   77, "s": -0.75, "v": -0.20 }
            ]
          },
          "female": {
            "slots": [
              { "slot": "hairFront", "label": "Front Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_tuft", "label": "Tuft" },
                { "id": "appearance::Mao-ao_F::mao-ao_forwardtuft_short", "label": "Forward Tuft (Short)" },
                { "id": "appearance::Mao-ao_F::mao-ao_forwardtuft_long", "label": "Forward Tuft (Long)" }
              ]},
              { "slot": "hairBack", "label": "Back Hair", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_splayedknot_medium", "label": "Splayed Knot" },
                { "id": "appearance::Mao-ao_F::mao-ao_long_ponytail", "label": "Long Ponytail" }
              ]},
              { "slot": "hairSide", "label": "Side Hair (R)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_shoulder_length_drape", "label": "Shoulder Drape" },
                { "id": "appearance::Mao-ao_F::mao-ao_braid-R", "label": "Braid (Right)" },
                { "id": "appearance::Mao-ao_F::mao-ao_braidcluster-R", "label": "Braid Cluster (Right)" }
              ]},
              { "slot": "hairSideL", "label": "Side Hair (L)", "options": [
                { "id": null, "label": "None" },
                { "id": "appearance::Mao-ao_F::mao-ao_braid-L", "label": "Braid (Left)" }
              ]}
            ],
            "colorOptions": [
              { "label": "Earth",   "h": -70,  "s": -0.80, "v": -0.55 },
              { "label": "Olive",   "h": -40,  "s": -0.70, "v": -0.45 },
              { "label": "Sage",    "h":   0,  "s": -0.70, "v": -0.30 },
              { "label": "Seafoam", "h":  30,  "s": -0.60, "v": -0.15 },
              { "label": "Ash",     "h":  10,  "s": -0.90, "v":  0.25 },
              { "label": "Onyx",    "h":   0,  "s": -0.90, "v": -0.85 },
              { "label": "Brown",   "h": -113, "s": -0.45, "v": -0.45 },
              { "label": "Rust",    "h": -143, "s": -0.40, "v": -0.40 },
              { "label": "Amber",   "h": -113, "s": -0.35, "v": -0.25 },
              { "label": "Ochre",   "h":  -83, "s": -0.45, "v": -0.20 },
              { "label": "Lichen",  "h":  -23, "s": -0.55, "v": -0.25 },
              { "label": "Slate",   "h":   77, "s": -0.75, "v": -0.20 }
            ]
          }
        }
      }
    },

    "trickBones": {
      "defaultUnlocked": ["smuggle", "trap", "punish"],
      "defaultLoadout": ["smuggle", "trap", "punish", "smuggle", "trap", "punish"],
      "loadoutSize": 6,
      "summaryDisplay": {
        "glyphSizePx": 14,
        "multiplyGlyphScale": 0.75,
        "gapPx": 6,
        "rowGapPx": 4,
        "marginTopPx": 6,
        "maxWidthPx": 220,
        "fontSizeRem": 0.68,
        "letterS