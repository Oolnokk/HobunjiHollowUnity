window.SCRATCHBONES_CONFIG = {
  // WebSocket relay URL for online multiplayer.
  // Set this to your ngrok (or other public) address when running remotely,
  // or remove / comment it out to fall back to ws://localhost:8080 for local dev.
  // Example: wsUrl: 'wss://mustang-walk-schematic.ngrok-free.dev',
  wsUrl: 'wss://mustang-walk-schematic.ngrok-free.dev',


  // Global clothing color tuning offsets.
  clothingHueOffset: 0,
  clothingSatOffset: 0,
  clothingLightOffset: 0,

  game: {
    "debug": {
      "enabled": true,
      "includeConsoleDebug": true,
      "eventLogLimit": 400,
      "trace": {
        "gameplayFlow": true,
        "layerPromotion": false,
        "audio": false,
        "candlelight": false,
        "actions": true
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
    "mapBuilder": {
      "editor2d": {
        "zoom": { "min": 6, "fitMin": 8, "max": 70, "fitMarginPx": 48, "wheelInScale": 1.12, "wheelOutScale": 0.89 }
      },
      "previewCamera": {
        "fovDegrees": 48,
        "nearClip": 0.1,
        "farClip": 220,
        "gameplayAngle": { "yawRadians": -0.72, "pitchRadians": 0.72 },
        "distance": { "default": 48, "min": 12, "max": 95, "wheelStep": 3 },
        "focus": { "distance": 20, "targetYOffset": 1.0, "followLerp": 0.18 },
        "touch": { "pinchEpsilonPx": 2 }
      }
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
      "availability": {
        "tletingan": {
          "genders": ["male"],
          "randomizableGenders": ["male"]
        }
      },
      "species": {
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
              { "label": "Glacier", "h": -85, "s": -0.90, "v": 0.35 },
              { "label": "Frost", "h": -60, "s": -0.85, "v": 0.25 },
              { "label": "Ash", "h": 0, "s": -0.90, "v": 0.15 },
              { "label": "Cloud", "h": 70, "s": -0.85, "v": 0.30 },
              { "label": "Slate", "h": -85, "s": -0.65, "v": -0.20 },
              { "label": "Storm", "h": -60, "s": -0.60, "v": -0.35 },
              { "label": "Charcoal", "h": 0, "s": -0.75, "v": -0.45 },
              { "label": "Moraine", "h": 70, "s": -0.70, "v": -0.30 },
              { "label": "Sandy", "h": 26, "s": 0.33, "v": 0.19 },
              { "label": "Chestnut", "h": 20, "s": 0.47, "v": 0.03 },
              { "label": "Amber", "h": 32, "s": 0.63, "v": 0.26 },
              { "label": "Blonde", "h": 45, "s": 0.26, "v": 0.36 }
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
              { "label": "Glacier", "h": -85, "s": -0.90, "v": 0.35 },
              { "label": "Frost", "h": -60, "s": -0.85, "v": 0.25 },
              { "label": "Ash", "h": 0, "s": -0.90, "v": 0.15 },
              { "label": "Cloud", "h": 70, "s": -0.85, "v": 0.30 },
              { "label": "Slate", "h": -85, "s": -0.65, "v": -0.20 },
              { "label": "Storm", "h": -60, "s": -0.60, "v": -0.35 },
              { "label": "Charcoal", "h": 0, "s": -0.75, "v": -0.45 },
              { "label": "Moraine", "h": 70, "s": -0.70, "v": -0.30 },
              { "label": "Sandy", "h": 26, "s": 0.33, "v": 0.19 },
              { "label": "Chestnut", "h": 20, "s": 0.47, "v": 0.03 },
              { "label": "Blonde", "h": 45, "s": 0.26, "v": 0.36 }
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
        { "id": "appearance::hat::riverlandskasa_low",   "label": "Riverland Kasa (Low)",  "price": 45, "category": "hat",      "description": "Traditional riverland hat, worn low.", "material": "rigid_fiber" },
        { "id": "appearance::hat::riverlandskasa_tight", "label": "Riverland Kasa (Tight)", "price": 45, "category": "hat",      "description": "Traditional riverland hat, tight fit.", "material": "rigid_fiber" },
        { "id": "appearance::hat::riverlandskasa_wide",  "label": "Riverland Kasa (Wide)", "price": 45, "category": "hat",      "description": "Traditional riverland hat, wide brim.", "material": "rigid_fiber" },
        { "id": "appearance::Kenkari_M::kenk_riverlandskasa_low",  "label": "Kenkari Kasa (Low)",  "price": 45, "category": "hat", "species": "kenkari", "gender": "male",   "description": "Kenkari riverland hat, worn low.", "material": "rigid_fiber" },
        { "id": "appearance::Kenkari_F::kenk_riverlandskasa_low",  "label": "Kenkari Kasa (Low)",  "price": 45, "category": "hat", "species": "kenkari", "gender": "female", "description": "Kenkari riverland hat, worn low.", "material": "rigid_fiber" },
        { "id": "appearance::Kenkari_M::kenk_riverlandskasa_wide", "label": "Kenkari Kasa (Wide)", "price": 45, "category": "hat", "species": "kenkari", "gender": "male",   "description": "Kenkari riverland hat, wide brim.", "material": "rigid_fiber" },
        { "id": "appearance::Kenkari_F::kenk_riverlandskasa_wide", "label": "Kenkari Kasa (Wide)", "price": 45, "category": "hat", "species": "kenkari", "gender": "female", "description": "Kenkari riverland hat, wide brim.", "material": "rigid_fiber" },
        { "id": "appearance::Kenkari_M::kenk_bowlkasa", "label": "Kenkari Bowl-Kasa", "price": 55, "category": "hat", "species": "kenkari", "gender": "male", "description": "A carved wooden bowl-kasa fitted for Kenkari horns.", "material": "wood" },
        { "id": "appearance::Kenkari_F::kenk_bowlkasa", "label": "Kenkari Bowl-Kasa", "price": 55, "category": "hat", "species": "kenkari", "gender": "female", "description": "A carved wooden bowl-kasa fitted for Kenkari horns.", "material": "wood" },
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
        { "id": "yellow", "label": "Yellow", "abbreviation": "Y", "hueAngle": 60 },
        { "id": "yellow_green", "label": "Yellow-Green", "abbreviation": "Y/G", "hueAngle": 90 },
        { "id": "green", "label": "Green", "abbreviation": "G", "hueAngle": 120 },
        { "id": "green_blue", "label": "Green-Blue", "abbreviation": "G/B", "hueAngle": 180 },
        { "id": "blue", "label": "Blue", "abbreviation": "B", "hueAngle": 240 },
        { "id": "blue_indigo", "label": "Blue-Indigo", "abbreviation": "B/I", "hueAngle": 255 },
        { "id": "indigo", "label": "Indigo", "abbreviation": "I", "hueAngle": 270 },
        { "id": "indigo_violet", "label": "Indigo-Violet", "abbreviation": "I/V", "hueAngle": 285 },
        { "id": "violet", "label": "Violet", "abbreviation": "V", "hueAngle": 300 }
      ],
      "variants": [
        { "id": "pure", "label": "Pure", "saturationPercent": 100, "brightnessPercent": 100 },
        { "id": "bright", "label": "Bright", "saturationPercent": 60, "brightnessPercent": 100 },
        { "id": "pale", "label": "Pale", "saturationPercent": 30, "brightnessPercent": 100 },
        { "id": "deep", "label": "Deep", "saturationPercent": 100, "brightnessPercent": 55 },
        { "id": "muted", "label": "Muted", "saturationPercent": 60, "brightnessPercent": 55 },
        { "id": "dusty", "label": "Dusty", "saturationPercent": 30, "brightnessPercent": 55 },
        { "id": "shadow", "label": "Shadow", "saturationPercent": 100, "brightnessPercent": 35 },
        { "id": "dark_muted", "label": "Dark Muted", "saturationPercent": 60, "brightnessPercent": 35 },
        { "id": "smoky", "label": "Smoky", "saturationPercent": 30, "brightnessPercent": 35 }
      ],
      "neutrals": [
        { "id": "white", "label": "White", "hex": "#FFFFFF", "acquisition": "achievement", "unlockSource": "achievement_future" },
        { "id": "silver", "label": "Silver", "hex": "#C0C0C0", "acquisition": "starter" },
        { "id": "gray", "label": "Gray", "hex": "#808080", "acquisition": "starter" },
        { "id": "charcoal", "label": "Charcoal", "hex": "#333333", "acquisition": "achievement", "unlockSource": "achievement_future" },
        { "id": "cream", "label": "Cream", "hex": "#FFF0CC", "acquisition": "starter" },
        { "id": "brown", "label": "Brown", "hex": "#7A4A24", "acquisition": "starter" }
      ],
      "categories": [
        { "id": "red", "label": "Red" },
        { "id": "red_orange", "label": "Red-Orange" },
        { "id": "orange", "label": "Orange" },
        { "id": "yellow_orange", "label": "Yellow-Orange" },
        { "id": "yellow", "label": "Yellow" },
        { "id": "yellow_green", "label": "Yellow-Green" },
        { "id": "green", "label": "Green" },
        { "id": "green_blue", "label": "Green-Blue" },
        { "id": "blue", "label": "Blue" },
        { "id": "blue_indigo", "label": "Blue-Indigo" },
        { "id": "indigo", "label": "Indigo" },
        { "id": "indigo_violet", "label": "Indigo-Violet" },
        { "id": "violet", "label": "Violet" },
        { "id": "neutral", "label": "Neutral" }
      ],
      "mysteryPools": [
        { "id": "red", "shopId": "mystery_dye_red", "label": "Red Mystery Dye", "hueFamilies": ["Red", "Red-Orange"], "description": "Grants one unowned Red or Red-Orange dye." },
        { "id": "orange", "shopId": "mystery_dye_orange", "label": "Orange Mystery Dye", "hueFamilies": ["Red-Orange", "Orange", "Yellow-Orange"], "description": "Grants one unowned Red-Orange, Orange, or Yellow-Orange dye." },
        { "id": "yellow", "shopId": "mystery_dye_yellow", "label": "Yellow Mystery Dye", "hueFamilies": ["Yellow-Orange", "Yellow", "Yellow-Green"], "description": "Grants one unowned Yellow-Orange, Yellow, or Yellow-Green dye." },
        { "id": "green", "shopId": "mystery_dye_green", "label": "Green Mystery Dye", "hueFamilies": ["Yellow-Green", "Green", "Green-Blue"], "description": "Grants one unowned Yellow-Green, Green, or Green-Blue dye." },
        { "id": "blue", "shopId": "mystery_dye_blue", "label": "Blue Mystery Dye", "hueFamilies": ["Green-Blue", "Blue", "Blue-Indigo"], "description": "Grants one unowned Green-Blue, Blue, or Blue-Indigo dye." },
        { "id": "indigo", "shopId": "mystery_dye_indigo", "label": "Indigo Mystery Dye", "hueFamilies": ["Blue-Indigo", "Indigo", "Indigo-Violet"], "description": "Grants one unowned Blue-Indigo, Indigo, or Indigo-Violet dye." },
        { "id": "violet", "shopId": "mystery_dye_violet", "label": "Violet Mystery Dye", "hueFamilies": ["Indigo-Violet", "Violet"], "description": "Grants one unowned Indigo-Violet or Violet dye." }
      ],
      "starterDyeIds": [
        "dye:CLOTH:dusty_red",
        "dye:CLOTH:dusty_red_orange",
        "dye:CLOTH:dusty_orange",
        "dye:CLOTH:dusty_yellow_orange",
        "dye:CLOTH:dusty_yellow",
        "dye:CLOTH:dusty_yellow_green",
        "dye:CLOTH:dusty_green",
        "dye:CLOTH:dusty_green_blue",
        "dye:CLOTH:dusty_blue",
        "dye:CLOTH:dusty_blue_indigo",
        "dye:CLOTH:dusty_indigo",
        "dye:CLOTH:dusty_indigo_violet",
        "dye:CLOTH:dusty_violet",
        "dye:CLOTH:silver",
        "dye:CLOTH:gray",
        "dye:CLOTH:cream",
        "dye:CLOTH:brown"
      ],
      "legacyDyeMigrations": {
        "dye:CLOTH:red": "dye:CLOTH:dusty_red",
        "dye:CLOTH:orange": "dye:CLOTH:dusty_orange",
        "dye:CLOTH:yellow": "dye:CLOTH:dusty_yellow",
        "dye:CLOTH:green": "dye:CLOTH:dusty_green",
        "dye:CLOTH:blue": "dye:CLOTH:dusty_blue",
        "dye:CLOTH:purple": "dye:CLOTH:dusty_violet",
        "dye:CLOTH:brown": "dye:CLOTH:brown",
        "dye:CLOTH:black": "dye:CLOTH:gray",
        "dye:CLOTH:white": "dye:CLOTH:silver",
        "dye:CLOTH:grey": "dye:CLOTH:gray",
        "dye:CLOTH:navy": "dye:CLOTH:shadow_blue",
        "dye:CLOTH:scarlet": "dye:CLOTH:pure_red",
        "dye:CLOTH:gold": "dye:CLOTH:bright_yellow",
        "dye:CLOTH:violet": "dye:CLOTH:pure_violet",
        "dye:CLOTH:forest": "dye:CLOTH:deep_green",
        "dye:CLOTH:ivory": "dye:CLOTH:cream",
        "dye:CLOTH:wine": "dye:CLOTH:shadow_red",
        "dye:CLOTH:cobalt": "dye:CLOTH:deep_blue",
        "dye:CLOTH:saddlebrown": "dye:CLOTH:brown",
        "dye:CLOTH:rust": "dye:CLOTH:deep_orange",
        "dye:CLOTH:sand": "dye:CLOTH:pale_yellow_orange",
        "dye:CLOTH:sienna": "dye:CLOTH:muted_orange",
        "dye:CLOTH:carmine": "dye:CLOTH:shadow_red",
        "dye:CLOTH:vermilion": "dye:CLOTH:bright_red_orange",
        "dye:CLOTH:rose": "dye:CLOTH:bright_violet",
        "dye:CLOTH:ruby": "dye:CLOTH:deep_red",
        "dye:CLOTH:brick": "dye:CLOTH:muted_red_orange",
        "dye:CLOTH:garnet": "dye:CLOTH:shadow_red",
        "dye:CLOTH:poppy": "dye:CLOTH:pure_red_orange",
        "dye:CLOTH:currant": "dye:CLOTH:dark_muted_red",
        "dye:CLOTH:claret": "dye:CLOTH:deep_red",
        "dye:CLOTH:coral_red": "dye:CLOTH:bright_red_orange",
        "dye:CLOTH:tangerine": "dye:CLOTH:pure_orange",
        "dye:CLOTH:persimmon": "dye:CLOTH:bright_orange",
        "dye:CLOTH:apricot": "dye:CLOTH:pale_orange",
        "dye:CLOTH:burnt_orange": "dye:CLOTH:deep_orange",
        "dye:CLOTH:pumpkin": "dye:CLOTH:muted_orange",
        "dye:CLOTH:ochre": "dye:CLOTH:muted_yellow_orange",
        "dye:CLOTH:copperleaf": "dye:CLOTH:muted_orange",
        "dye:CLOTH:marigold": "dye:CLOTH:bright_yellow_orange",
        "dye:CLOTH:flame": "dye:CLOTH:pure_red_orange",
        "dye:CLOTH:cantaloupe": "dye:CLOTH:pale_orange",
        "dye:CLOTH:lemon": "dye:CLOTH:pure_yellow",
        "dye:CLOTH:saffron": "dye:CLOTH:bright_yellow_orange",
        "dye:CLOTH:citrine": "dye:CLOTH:bright_yellow",
        "dye:CLOTH:honey": "dye:CLOTH:muted_yellow_orange",
        "dye:CLOTH:maize": "dye:CLOTH:pale_yellow",
        "dye:CLOTH:mustard": "dye:CLOTH:muted_yellow",
        "dye:CLOTH:butter": "dye:CLOTH:pale_yellow",
        "dye:CLOTH:flax": "dye:CLOTH:pale_yellow_orange",
        "dye:CLOTH:canary": "dye:CLOTH:bright_yellow",
        "dye:CLOTH:dandelion": "dye:CLOTH:pure_yellow",
        "dye:CLOTH:emerald": "dye:CLOTH:bright_green",
        "dye:CLOTH:malachite": "dye:CLOTH:deep_green",
        "dye:CLOTH:viridian": "dye:CLOTH:muted_green_blue",
        "dye:CLOTH:fern": "dye:CLOTH:muted_green",
        "dye:CLOTH:olive": "dye:CLOTH:dark_muted_yellow_green",
        "dye:CLOTH:mint": "dye:CLOTH:pale_green",
        "dye:CLOTH:pine": "dye:CLOTH:shadow_green",
        "dye:CLOTH:laurel": "dye:CLOTH:dusty_green",
        "dye:CLOTH:shamrock": "dye:CLOTH:bright_green",
        "dye:CLOTH:seafoam": "dye:CLOTH:pale_green_blue",
        "dye:CLOTH:sapphire": "dye:CLOTH:deep_blue",
        "dye:CLOTH:cerulean": "dye:CLOTH:bright_blue",
        "dye:CLOTH:sky": "dye:CLOTH:pale_blue",
        "dye:CLOTH:indigo": "dye:CLOTH:deep_indigo",
        "dye:CLOTH:lapis": "dye:CLOTH:muted_blue",
        "dye:CLOTH:turquoise": "dye:CLOTH:bright_green_blue",
        "dye:CLOTH:prussian": "dye:CLOTH:shadow_blue",
        "dye:CLOTH:cornflower": "dye:CLOTH:pale_blue",
        "dye:CLOTH:steel": "dye:CLOTH:muted_blue",
        "dye:CLOTH:aegean": "dye:CLOTH:dark_muted_blue",
        "dye:CLOTH:lavender": "dye:CLOTH:pale_violet",
        "dye:CLOTH:plum": "dye:CLOTH:muted_violet",
        "dye:CLOTH:mauve": "dye:CLOTH:pale_indigo_violet",
        "dye:CLOTH:orchid": "dye:CLOTH:bright_indigo_violet",
        "dye:CLOTH:byzantium": "dye:CLOTH:deep_violet",
        "dye:CLOTH:mulberry": "dye:CLOTH:muted_violet",
        "dye:CLOTH:lilac": "dye:CLOTH:pale_violet",
        "dye:CLOTH:grape": "dye:CLOTH:deep_indigo_violet",
        "dye:CLOTH:periwinkle": "dye:CLOTH:pale_blue_indigo",
        "dye:CLOTH:eggplant": "dye:CLOTH:dark_muted_violet"
      },
      "catalog": (() => {
        const hueFamilies = [
          { id: "red", label: "Red", hueAngle: 0 },
          { id: "red_orange", label: "Red-Orange", hueAngle: 15 },
          { id: "orange", label: "Orange", hueAngle: 30 },
          { id: "yellow_orange", label: "Yellow-Orange", hueAngle: 45 },
          { id: "yellow", label: "Yellow", hueAngle: 60 },
          { id: "yellow_green", label: "Yellow-Green", hueAngle: 90 },
          { id: "green", label: "Green", hueAngle: 120 },
          { id: "green_blue", label: "Green-Blue", hueAngle: 180 },
          { id: "blue", label: "Blue", hueAngle: 240 },
          { id: "blue_indigo", label: "Blue-Indigo", hueAngle: 255 },
          { id: "indigo", label: "Indigo", hueAngle: 270 },
          { id: "indigo_violet", label: "Indigo-Violet", hueAngle: 285 },
          { id: "violet", label: "Violet", hueAngle: 300 }
        ];
        const variants = [
          { id: "pure", label: "Pure", saturationPercent: 100, brightnessPercent: 100 },
          { id: "bright", label: "Bright", saturationPercent: 60, brightnessPercent: 100 },
          { id: "pale", label: "Pale", saturationPercent: 30, brightnessPercent: 100 },
          { id: "deep", label: "Deep", saturationPercent: 100, brightnessPercent: 55 },
          { id: "muted", label: "Muted", saturationPercent: 60, brightnessPercent: 55 },
          { id: "dusty", label: "Dusty", saturationPercent: 30, brightnessPercent: 55 },
          { id: "shadow", label: "Shadow", saturationPercent: 100, brightnessPercent: 35 },
          { id: "dark_muted", label: "Dark Muted", saturationPercent: 60, brightnessPercent: 35 },
          { id: "smoky", label: "Smoky", saturationPercent: 30, brightnessPercent: 35 }
        ];
        const neutrals = [
          { id: "white", label: "White", hex: "#FFFFFF", acquisition: "achievement", unlockSource: "achievement_future" },
          { id: "silver", label: "Silver", hex: "#C0C0C0", acquisition: "starter" },
          { id: "gray", label: "Gray", hex: "#808080", acquisition: "starter" },
          { id: "charcoal", label: "Charcoal", hex: "#333333", acquisition: "achievement", unlockSource: "achievement_future" },
          { id: "cream", label: "Cream", hex: "#FFF0CC", acquisition: "starter" },
          { id: "brown", label: "Brown", hex: "#7A4A24", acquisition: "starter" }
        ];
        const poolFamilies = {
          red: ["Red", "Red-Orange"],
          orange: ["Red-Orange", "Orange", "Yellow-Orange"],
          yellow: ["Yellow-Orange", "Yellow", "Yellow-Green"],
          green: ["Yellow-Green", "Green", "Green-Blue"],
          blue: ["Green-Blue", "Blue", "Blue-Indigo"],
          indigo: ["Blue-Indigo", "Indigo", "Indigo-Violet"],
          violet: ["Indigo-Violet", "Violet"]
        };
        function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
        function rgbToHex(r, g, b) {
          return "#" + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("").toUpperCase();
        }
        function hsvToRgb(h, sPercent, vPercent) {
          const hNorm = ((Number(h) % 360) + 360) % 360;
          const s = clamp(sPercent, 0, 100) / 100;
          const v = clamp(vPercent, 0, 100) / 100;
          const c = v * s;
          const x = c * (1 - Math.abs(((hNorm / 60) % 2) - 1));
          const m = v - c;
          let r1 = 0, g1 = 0, b1 = 0;
          if (hNorm < 60) [r1, g1, b1] = [c, x, 0];
          else if (hNorm < 120) [r1, g1, b1] = [x, c, 0];
          else if (hNorm < 180) [r1, g1, b1] = [0, c, x];
          else if (hNorm < 240) [r1, g1, b1] = [0, x, c];
          else if (hNorm < 300) [r1, g1, b1] = [x, 0, c];
          else [r1, g1, b1] = [c, 0, x];
          return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
        }
        // Precomputed offline from the portrait/swatch filter fitter for the CSS chain:
        // hue-rotate(...) saturate(...) brightness(...). Keeping these values static avoids
        // running the expensive optimizer every time this config is evaluated.
        const fittedColors = {
          "dye:CLOTH:pure_red": { h: -139.268, s: 10.2, v: -0.699 },
          "dye:CLOTH:bright_red": { h: -139.268, s: 1.712, v: -0.255 },
          "dye:CLOTH:pale_red": { h: -139.268, s: -0.071, v: 0.08 },
          "dye:CLOTH:deep_red": { h: -139.268, s: 10.2, v: -0.835 },
          "dye:CLOTH:muted_red": { h: -139.268, s: 1.712, v: -0.591 },
          "dye:CLOTH:dusty_red": { h: -139.268, s: -0.063, v: -0.408 },
          "dye:CLOTH:shadow_red": { h: -139.268, s: 10.2, v: -0.895 },
          "dye:CLOTH:dark_muted_red": { h: -139.268, s: 1.674, v: -0.738 },
          "dye:CLOTH:smoky_red": { h: -139.268, s: -0.049, v: -0.625 },
          "dye:CLOTH:pure_red_orange": { h: -121.565, s: 4.392, v: -0.446 },
          "dye:CLOTH:bright_red_orange": { h: -121.77, s: 1.003, v: -0.105 },
          "dye:CLOTH:pale_red_orange": { h: -121.642, s: -0.229, v: 0.155 },
          "dye:CLOTH:deep_red_orange": { h: -121.642, s: 4.403, v: -0.697 },
          "dye:CLOTH:muted_red_orange": { h: -121.642, s: 1, v: -0.508 },
          "dye:CLOTH:dusty_red_orange": { h: -120.708, s: -0.228, v: -0.365 },
          "dye:CLOTH:shadow_red_orange": { h: -121.862, s: 4.436, v: -0.808 },
          "dye:CLOTH:dark_muted_red_orange": { h: -122.01, s: 0.986, v: -0.687 },
          "dye:CLOTH:smoky_red_orange": { h: -120.916, s: -0.217, v: -0.597 },
          "dye:CLOTH:pure_orange": { h: -101.25, s: 2.654, v: -0.193 },
          "dye:CLOTH:bright_orange": { h: -101.145, s: 0.686, v: 0.049 },
          "dye:CLOTH:pale_orange": { h: -101.407, s: -0.286, v: 0.23 },
          "dye:CLOTH:deep_orange": { h: -101.407, s: 2.661, v: -0.558 },
          "dye:CLOTH:muted_orange": { h: -101.407, s: 0.688, v: -0.425 },
          "dye:CLOTH:dusty_orange": { h: -101.407, s: -0.281, v: -0.325 },
          "dye:CLOTH:shadow_orange": { h: -100.957, s: 2.64, v: -0.717 },
          "dye:CLOTH:dark_muted_orange": { h: -102.167, s: 0.677, v: -0.636 },
          "dye:CLOTH:smoky_orange": { h: -99.925, s: -0.272, v: -0.57 },
          "dye:CLOTH:pure_yellow_orange": { h: -82.997, s: 2.085, v: 0.056 },
          "dye:CLOTH:bright_yellow_orange": { h: -82.826, s: 0.632, v: 0.2 },
          "dye:CLOTH:pale_yellow_orange": { h: -82.933, s: -0.256, v: 0.305 },
          "dye:CLOTH:deep_yellow_orange": { h: -82.933, s: 2.084, v: -0.42 },
          "dye:CLOTH:muted_yellow_orange": { h: -82.933, s: 0.632, v: -0.342 },
          "dye:CLOTH:dusty_yellow_orange": { h: -82.156, s: -0.247, v: -0.282 },
          "dye:CLOTH:shadow_yellow_orange": { h: -82.749, s: 2.08, v: -0.63 },
          "dye:CLOTH:dark_muted_yellow_orange": { h: -82.624, s: 0.618, v: -0.58 },
          "dye:CLOTH:smoky_yellow_orange": { h: -81.138, s: -0.234, v: -0.542 },
          "dye:CLOTH:pure_yellow": { h: -68.856, s: 1.933, v: 0.309 },
          "dye:CLOTH:bright_yellow": { h: -68.856, s: 0.707, v: 0.35 },
          "dye:CLOTH:pale_yellow": { h: -68.856, s: -0.171, v: 0.381 },
          "dye:CLOTH:deep_yellow": { h: -68.856, s: 1.933, v: -0.281 },
          "dye:CLOTH:muted_yellow": { h: -68.856, s: 0.707, v: -0.259 },
          "dye:CLOTH:dusty_yellow": { h: -68.856, s: -0.166, v: -0.242 },
          "dye:CLOTH:shadow_yellow": { h: -68.856, s: 1.933, v: -0.543 },
          "dye:CLOTH:dark_muted_yellow": { h: -68.856, s: 0.693, v: -0.529 },
          "dye:CLOTH:smoky_yellow": { h: -68.856, s: -0.156, v: -0.518 },
          "dye:CLOTH:pure_yellow_green": { h: -43.128, s: 2.137, v: 0.16 },
          "dye:CLOTH:bright_yellow_green": { h: -43.196, s: 0.732, v: 0.26 },
          "dye:CLOTH:pale_yellow_green": { h: -43.024, s: -0.188, v: 0.336 },
          "dye:CLOTH:deep_yellow_green": { h: -43.024, s: 2.14, v: -0.364 },
          "dye:CLOTH:muted_yellow_green": { h: -43.024, s: 0.733, v: -0.308 },
          "dye:CLOTH:dusty_yellow_green": { h: -43.024, s: -0.182, v: -0.267 },
          "dye:CLOTH:shadow_yellow_green": { h: -43.32, s: 2.133, v: -0.595 },
          "dye:CLOTH:dark_muted_yellow_green": { h: -42.528, s: 0.723, v: -0.561 },
          "dye:CLOTH:smoky_yellow_green": { h: -44.002, s: -0.175, v: -0.534 },
          "dye:CLOTH:pure_green": { h: -19.383, s: 3.135, v: 0.009 },
          "dye:CLOTH:bright_green": { h: -19.383, s: 1.14, v: 0.17 },
          "dye:CLOTH:pale_green": { h: -19.383, s: -0.037, v: 0.291 },
          "dye:CLOTH:deep_green": { h: -19.383, s: 3.135, v: -0.446 },
          "dye:CLOTH:muted_green": { h: -19.383, s: 1.14, v: -0.358 },
          "dye:CLOTH:dusty_green": { h: -19.383, s: -0.03, v: -0.292 },
          "dye:CLOTH:shadow_green": { h: -19.383, s: 3.135, v: -0.648 },
          "dye:CLOTH:dark_muted_green": { h: -19.383, s: 1.121, v: -0.591 },
          "dye:CLOTH:smoky_green": { h: -19.383, s: -0.018, v: -0.55 },
          "dye:CLOTH:pure_green_blue": { h: 40.732, s: 2.031, v: 0.111 },
          "dye:CLOTH:bright_green_blue": { h: 40.732, s: 0.641, v: 0.231 },
          "dye:CLOTH:pale_green_blue": { h: 40.732, s: -0.241, v: 0.322 },
          "dye:CLOTH:deep_green_blue": { h: 40.732, s: 2.031, v: -0.39 },
          "dye:CLOTH:muted_green_blue": { h: 40.732, s: 0.641, v: -0.324 },
          "dye:CLOTH:dusty_green_blue": { h: 40.732, s: -0.236, v: -0.275 },
          "dye:CLOTH:shadow_green_blue": { h: 40.732, s: 2.031, v: -0.612 },
          "dye:CLOTH:dark_muted_green_blue": { h: 40.732, s: 0.627, v: -0.57 },
          "dye:CLOTH:smoky_green_blue": { h: 40.732, s: -0.226, v: -0.539 },
          "dye:CLOTH:pure_blue": { h: 111.144, s: 36.783, v: -0.898 },
          "dye:CLOTH:bright_blue": { h: 111.144, s: 2.683, v: -0.374 },
          "dye:CLOTH:pale_blue": { h: 111.144, s: 0.121, v: 0.021 },
          "dye:CLOTH:deep_blue": { h: 111.144, s: 36.783, v: -0.944 },
          "dye:CLOTH:muted_blue": { h: 111.144, s: 2.683, v: -0.657 },
          "dye:CLOTH:dusty_blue": { h: 111.144, s: 0.131, v: -0.441 },
          "dye:CLOTH:shadow_blue": { h: 111.144, s: 36.783, v: -0.965 },
          "dye:CLOTH:dark_muted_blue": { h: 111.144, s: 2.621, v: -0.78 },
          "dye:CLOTH:smoky_blue": { h: 111.144, s: 0.149, v: -0.646 },
          "dye:CLOTH:pure_blue_indigo": { h: 123.759, s: 19.581, v: -0.823 },
          "dye:CLOTH:bright_blue_indigo": { h: 123.622, s: 2.263, v: -0.33 },
          "dye:CLOTH:pale_blue_indigo": { h: 123.707, s: 0.041, v: 0.043 },
          "dye:CLOTH:deep_blue_indigo": { h: 123.707, s: 19.617, v: -0.903 },
          "dye:CLOTH:muted_blue_indigo": { h: 123.707, s: 2.261, v: -0.632 },
          "dye:CLOTH:dusty_blue_indigo": { h: 124.333, s: 0.048, v: -0.428 },
          "dye:CLOTH:shadow_blue_indigo": { h: 123.56, s: 19.723, v: -0.939 },
          "dye:CLOTH:dark_muted_blue_indigo": { h: 123.46, s: 2.216, v: -0.764 },
          "dye:CLOTH:smoky_blue_indigo": { h: 124.194, s: 0.064, v: -0.638 },
          "dye:CLOTH:pure_indigo": { h: 137.079, s: 13.414, v: -0.747 },
          "dye:CLOTH:bright_indigo": { h: 137.148, s: 2.049, v: -0.284 },
          "dye:CLOTH:pale_indigo": { h: 136.976, s: 0.018, v: 0.066 },
          "dye:CLOTH:deep_indigo": { h: 136.976, s: 13.445, v: -0.862 },
          "dye:CLOTH:muted_indigo": { h: 136.976, s: 2.051, v: -0.607 },
          "dye:CLOTH:dusty_indigo": { h: 136.976, s: 0.026, v: -0.416 },
          "dye:CLOTH:shadow_indigo": { h: 137.272, s: 13.357, v: -0.911 },
          "dye:CLOTH:dark_muted_indigo": { h: 136.478, s: 2.01, v: -0.749 },
          "dye:CLOTH:smoky_indigo": { h: 137.95, s: 0.042, v: -0.63 },
          "dye:CLOTH:pure_indigo_violet": { h: 149.568, s: 10.696, v: -0.673 },
          "dye:CLOTH:bright_indigo_violet": { h: 149.693, s: 2.015, v: -0.239 },
          "dye:CLOTH:pale_indigo_violet": { h: 149.615, s: 0.047, v: 0.088 },
          "dye:CLOTH:deep_indigo_violet": { h: 149.615, s: 10.689, v: -0.82 },
          "dye:CLOTH:muted_indigo_violet": { h: 149.615, s: 2.015, v: -0.582 },
          "dye:CLOTH:dusty_indigo_violet": { h: 150.181, s: 0.059, v: -0.403 },
          "dye:CLOTH:shadow_indigo_violet": { h: 149.749, s: 10.668, v: -0.886 },
          "dye:CLOTH:dark_muted_indigo_violet": { h: 149.839, s: 1.974, v: -0.732 },
          "dye:CLOTH:smoky_indigo_violet": { h: 150.93, s: 0.078, v: -0.621 },
          "dye:CLOTH:pure_violet": { h: 160.617, s: 9.373, v: -0.598 },
          "dye:CLOTH:bright_violet": { h: 160.617, s: 2.107, v: -0.194 },
          "dye:CLOTH:pale_violet": { h: 160.617, s: 0.12, v: 0.11 },
          "dye:CLOTH:deep_violet": { h: 160.617, s: 9.373, v: -0.779 },
          "dye:CLOTH:muted_violet": { h: 160.617, s: 2.107, v: -0.558 },
          "dye:CLOTH:dusty_violet": { h: 160.617, s: 0.129, v: -0.391 },
          "dye:CLOTH:shadow_violet": { h: 160.617, s: 9.373, v: -0.86 },
          "dye:CLOTH:dark_muted_violet": { h: 160.617, s: 2.066, v: -0.717 },
          "dye:CLOTH:smoky_violet": { h: 160.617, s: 0.145, v: -0.614 },
          "dye:CLOTH:white": { h: -178, s: -1, v: 0.411 },
          "dye:CLOTH:silver": { h: -178, s: -1, v: 0.062 },
          "dye:CLOTH:gray": { h: -180, s: -1, v: -0.292 },
          "dye:CLOTH:charcoal": { h: -171, s: -1, v: -0.718 },
          "dye:CLOTH:cream": { h: -85.901, s: -0.522, v: 0.331 },
          "dye:CLOTH:brown": { h: -106.121, s: 1.187, v: -0.549 }
        };
        const catalog = [];
        hueFamilies.forEach((family, familyIndex) => {
          variants.forEach((variant, variantIndex) => {
            const rgb = hsvToRgb(family.hueAngle, variant.saturationPercent, variant.brightnessPercent);
            const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
            const label = variant.label + " " + family.label;
            const mysteryPools = Object.entries(poolFamilies)
              .filter(([, families]) => families.includes(family.label))
              .map(([poolId]) => poolId);
            catalog.push({
              id: "dye:CLOTH:" + variant.id + "_" + family.id,
              label,
              group: "cloth",
              dyeSlot: "CLOTH",
              dyeCategory: family.id,
              color: { ...fittedColors["dye:CLOTH:" + variant.id + "_" + family.id] },
              hueFamily: family.label,
              hueFamilyId: family.id,
              hueAngle: family.hueAngle,
              variant: variant.label,
              variantId: variant.id,
              saturationPercent: variant.saturationPercent,
              brightnessPercent: variant.brightnessPercent,
              hex,
              neutral: false,
              acquisition: variant.id === "dusty" ? "starter" : "mystery",
              mysteryPools,
              sortOrder: familyIndex * variants.length + variantIndex
            });
          });
        });
        neutrals.forEach((neutral, index) => {
          catalog.push({
            id: "dye:CLOTH:" + neutral.id,
            label: neutral.label,
            group: "cloth",
            dyeSlot: "CLOTH",
            dyeCategory: "neutral",
            color: { ...fittedColors["dye:CLOTH:" + neutral.id] },
            hex: neutral.hex,
            neutral: true,
            acquisition: neutral.acquisition,
            unlockSource: neutral.unlockSource,
            mysteryPools: [],
            sortOrder: hueFamilies.length * variants.length + index
          });
        });
        return catalog;
      })()
    },
    "chips": {
      "starting": 30,
      "challengeBaseTransfer": 1,
      "concedeRoundChipLoss": 1,
      "walletDisplay": {
        "tiers": [
          { "id": "sun", "value": 1 },
          { "id": "tinmoon", "value": 5 },
          { "id": "eclipse", "value": 20 }
        ],
        "maxIconsPerSeat": 18,
        "seatChipBadge": {
          "coinTierId": "tinmoon",
          "iconSizePx": 22,
          "gapPx": 6,
          "fontSizeRem": 0.82,
          "color": "var(--text)"
        }
      },
      "poolDisplay": {
        "maxIcons": 28,
        "widthPx": 275,
        "heightPx": 120,
        "coinSizePx": 63,
        "spreadXPx": 105,
        "spreadYPx": 35,
        "offsetXPx": 100,
        "offsetYPx": -48,
        "totalLabel": {
          "rightPx": 8,
          "bottomPx": 4,
          "fontSizePx": 48,
          "lineHeight": 1,
          "color": "#ffffff"
        }
      },
      "challengeStake": {
        "tiers": [
          { "id": "sun", "value": 1 },
          { "id": "tinmoon", "value": 5 },
          { "id": "eclipse", "value": 20 }
        ],
        "animation": {
          "openMs": 280,
          "callMs": 280,
          "raiseOutMs": 190,
          "raiseInMs": 300
        }
      },
      "transferAnimation": {
        "clusterMoveMs": 140,
        "anteMs": 120,
        "clearPayoutMs": 170,
        "multiAnteSettleDelayMs": 24,
        "easing": "cubic-bezier(0.22, 0.61, 0.36, 1)",
        "coinSizePx": 24,
        "maxIconsPerCluster": 10
      },
      "cards": {
        "transferAnimation": {
          "dealSpeedMultiplier": 2.0
        }
      },
      "clearReward": {
        "base": 1,
        "increment": 1
      },
      "ante": {
        "start": 2,
        "increment": 2
      }
    },
    "timers": {
      "challengeSeconds": 7,
      "challengeIntroMs": 1100,
      "aiThinkMs": 325,
      "aiDecisionDelays": {
        "turnMinMs": 210,
        "turnMaxMs": 650,
        "challengeMinMs": 180,
        "challengeMaxMs": 1100,
        "bettingMinMs": 100,
        "bettingMaxMs": 325,
        "challengeStaggerMs": 110
      }
    },
    "portrait": {
      "xformPresets": {
        "A": { "ax": -0.2, "ay": 0, "scaleX": 2.55, "scaleY": 2.55, "rotDeg": 0 },
        "B": { "ax": -0.0983, "ay": -0.0809, "scaleX": 2.49, "scaleY": 2.49, "rotDeg": 0 },
        "C": { "ax": 0,       "ay": 0,       "scaleX": 1,    "scaleY": 1,    "rotDeg": 0 },
        "D": { "ax": 0,       "ay": 0,       "scaleX": 1,    "scaleY": 1,    "rotDeg": 0 }
      },
      "cosmetics": {
        "collaredTag": "collared",
        "shirtbeardIds": ["kenk_shirtbeard", "kenk_shirtbeard_f"],
        "collarLockedFacialHairIds": ["kenk_shirtbeard", "kenk_shirtbeard_f"]
      },
      "mouthExpressions": {
        "opacityByExpressionAndSpecies": {
          "neutral": {
            "mao-ao": 0,
            "engh-sho": 0
          }
        }
      },
      "expressions": {
        "durationMs": 10000,
        "restingChipNeutralBandRatio": 0.15
      },
      "layering": {
        "hatUnderHoodTag": "hood-layer:under",
        "eyeAccessoryAboveUnderHoodHatTag": "layer:eye-accessory-above-under-hood-hat"
      },
      "randomization": {
        "minimumNpcClothingArticles": 1,
        "clothingSlots": ["hat", "hood", "torsoCosmetic", "armCosmetic"],
        "clothingRepairSlotPreference": ["torsoCosmetic", "armCosmetic", "hat", "hood"],
        "clothingOptionPoolsBySlot": {
          "hat": "hatOptions",
          "hood": "hoodOptions",
          "torsoCosmetic": "torsoPortraitOptions",
          "armCosmetic": "armPortraitOptions"
        },
        "materialTags": {
          "cloth": "cloth"
        },
        "clothHoodColorSourceSlots": ["armCosmetic", "torsoCosmetic"],
        "npcRequiredClothingPaletteKeys": ["B", "C"],
        "clothingFallbackTintSlotsBySlot": {
          "hat": "HAT",
          "hood": "HOOD",
          "torsoCosmetic": "CLOTH",
          "armCosmetic": "CLOTH"
        }
      },
      "blink": {
        "enabled": true,
        "minIntervalMs": 2500,
        "maxIntervalMs": 6000,
        "durationMs": 140,
        "flurryChance": 0.18,
        "flurryCountMin": 1,
        "flurryCountMax": 2,
        "flurryIntervalMs": 280
      },
      "emotes": {
        "laugh": {
          "puffCount": 3,
          "inflateDurationSeconds": 0.12,
          "deflateDurationSeconds": 0.14,
          "pauseDurationSeconds": 0.18,
          "settleDurationSeconds": 0.60,
          "mouthLaughMs": 1140,
          "mouthRestExpression": "smile"
        },
        "disgust": {
          "horizontalDeformationScale": 0.2
        }
      }
    },
    "ai": {
      "pveSubmenu": {
        "label": "PvE Options",
        "defaultMode": "regular",
        "defaultMinRank": "easy",
        "defaultMaxRank": "hard",
        "rangeLabel": "Random difficulty range:",
        "rangeSeparator": "to",
        "rankOrder": ["easy", "normal", "hard", "boss"],
        "options": [
          { "id": "regular", "label": "Regular Play", "desc": "Use configured NPC difficulty." },
          { "id": "difficulty-test", "label": "NPC Difficulty Test", "desc": "Randomize each NPC difficulty in the selected range." }
        ]
      },
      "decision": {
        "readProfile": {
          "neutralBluffRate": 0.5,
          "bluffRateWeight": 0.42,
          "repeatRankCountWeight": 0.05,
          "repeatedCountWeight": 0.015,
          "repeatPressureMax": 0.18,
          "currentBluffStreakWeight": 0.09,
          "bluffStreakPressureMax": 0.22,
          "currentTruthStreakWeight": 0.05,
          "truthStreakPressureMax": 0.16,
          "challengeWinWeight": 0.08,
          "challengeWinPressureMax": 0.2,
          "challengeLossWeight": 0.05,
          "challengeLossPressureMax": 0.14,
          "snapWeight": 0.1,
          "overSuspectSnapWeight": 0.16,
          "repeatClaimBiasIncrease": 0.06,
          "claimSizeBiasFreeCards": 2,
          "claimSizeBiasWeight": 0.015,
          "truthBiasDampenMultiplier": 0.55,
          "truthBiasDecrease": 0.1,
          "bluffBiasDampenMultiplier": 0.55,
          "bluffBiasIncrease": 0.14,
          "challengeWinBiasIncrease": 0.18,
          "challengeLossBiasDecrease": 0.14,
          "quickJudgmentBiasMin": -1,
          "quickJudgmentBiasMax": 1
        },
        "challenge": {
          "cardCountSoftThreshold": 3,
          "cardCountSoftBonus": 0.1,
          "cardCountHardThreshold": 5,
          "cardCountHardBonus": 0.08,
          "lowChipThreshold": 2,
          "lowChipSuspicionAdjustment": -0.18,
          "highChipThreshold": 8,
          "highChipSuspicionAdjustment": 0.05,
          "personalitySuspicionWeight": 0.34,
          "personalityAggressionWeight": 0.08,
          "overSuspectBonus": 0.1,
          "cardCountingSuspicionWeight": 0.35,
          "cardCountingImpossibleWeight": 0.22,
          "cardCountingDeckPressureWeight": 0.08,
          "cardCountingAbundanceReliefWeight": 0.12
        },
        "delays": {
          "turnComplexityBase": 0.22,
          "turnHandSizeWeight": 0.32,
          "turnOpeningRankWeight": 0.18,
          "turnTargetRankWeight": 0.12,
          "turnFewMatchWeight": 0.15,
          "turnMatchWeight": 0.05,
          "turnOpponentWeight": 0.04,
          "turnPaceComplexityWeight": 0.7,
          "turnPaceStyleWeight": 0.3,
          "turnRandomWeight": 0.12,
          "turnCourageTempoWeight": 0.4,
          "turnAggressionTempoWeight": 0.3,
          "turnHonestyTempoWeight": 0.3,
          "challengeUncertaintyBase": 0.45,
          "challengeImpossibleOverageWeight": 0.14,
          "challengeReadCertaintyBase": 0.18,
          "challengeReadCertaintyWeight": 0.6,
          "challengeOpeningHandPressure": 0.08,
          "challengeHandPressureBase": 0.2,
          "challengeMatchPressureWeight": 0.05,
          "challengeRandomWeight": 0.08,
          "challengePaceUncertaintyWeight": 0.72,
          "challengePaceStyleWeight": 0.28,
          "challengeCourageTempoWeight": 0.46,
          "challengeSuspicionTempoWeight": 0.34,
          "challengeAggressionTempoWeight": 0.2,
          "bettingNeutralConfidence": 0.5,
          "bettingDefaultFoldFloor": 0.32,
          "bettingConfidenceGapWeight": 0.6,
          "bettingStakePressureMax": 0.25,
          "bettingStakePressureWeight": 0.03,
          "bettingCallPressureMax": 0.2,
          "bettingCallPressureWeight": 0.05,
          "bettingRandomWeight": 0.08,
          "bettingUncertaintyBase": 0.42,
          "bettingPaceUncertaintyWeight": 0.66,
          "bettingPaceStyleWeight": 0.34,
          "bettingCourageTempoWeight": 0.5,
          "bettingAggressionTempoWeight": 0.3,
          "bettingGreedTempoWeight": 0.2,
          "bettingDecisiveConfidenceGap": 0.42,
          "bettingDecisiveDelayFraction": 0.12,
          "bettingDecisiveDelayMinOffsetMs": 20
        },
        "play": {
          "naiveOpeningTruthChance": 0.82,
          "naiveOpeningBestRankChance": 0.7,
          "naiveWildTruthBaseChance": 0.38,
          "naiveWildTruthHonestyWeight": 0.18,
          "naiveBluffChanceMax": 0.92,
          "naiveBluffChanceBase": 0.42,
          "naiveBluffHonestyWeight": 0.28,
          "naiveLowHandBluffBonus": 0.18,
          "naiveBrokeBluffChance": 0.5,
          "heuristicHugeTruthCount": 5,
          "heuristicTruthBaitHonesty": 0.68,
          "heuristicTruthBaitMaxCount": 6,
          "heuristicMultiPlayMinCount": 2,
          "heuristicMultiPlayMaxCount": 4,
          "heuristicOpeningNaturalThreshold": 3,
          "heuristicOpeningNaturalChanceBase": 0.52,
          "heuristicOpeningNaturalGreedWeight": 0.22,
          "heuristicOpeningTruthfulThreshold": 3,
          "heuristicOpeningTruthfulChanceBase": 0.32,
          "heuristicOpeningTruthfulGreedWeight": 0.2,
          "heuristicSaveWildHonesty": 0.62,
          "heuristicNaturalMultiThreshold": 3,
          "heuristicNaturalMultiChanceBase": 0.42,
          "heuristicNaturalMultiGreedWeight": 0.22,
          "heuristicLowHandSize": 3,
          "heuristicHighHonestyWildThreshold": 0.74,
          "heuristicLowChipThreshold": 2,
          "heuristicMidChipThreshold": 5,
          "heuristicHighHonestyLowChipBluffBase": 0.1,
          "heuristicHighHonestyLowChipBluffWeight": 0.4,
          "heuristicHighHonestyMidChipBluffBase": 0.18,
          "heuristicHighHonestyMidChipBluffWeight": 0.45,
          "heuristicHighHonestyHighChipBluffBase": 0.28,
          "heuristicHighHonestyHighChipBluffWeight": 0.5,
          "heuristicWildUseLowHandSize": 2,
          "heuristicWildUseChanceBase": 0.18,
          "heuristicWildUseHonestyWeight": 0.38,
          "heuristicAggressiveBluffThreshold": 0.74,
          "heuristicModerateBluffThreshold": 0.52,
          "heuristicAggressiveBluffCap": 4,
          "heuristicModerateBluffCap": 3,
          "heuristicCautiousBluffCap": 2,
          "heuristicBluffExtraChanceBase": 0.4,
          "heuristicBluffExtraGreedWeight": 0.2,
          "heuristicLowHonestyThreshold": 0.32,
          "heuristicMidHonestyThreshold": 0.68,
          "heuristicLowChipBluffBase": 0.12,
          "heuristicLowChipBluffAggressionWeight": 0.45,
          "heuristicMidChipBluffBase": 0.24,
          "heuristicMidChipBluffAggressionWeight": 0.58,
          "heuristicHighChipBluffBase": 0.4,
          "heuristicHighChipBluffAggressionWeight": 0.72,
          "heuristicHighChipBluffMax": 0.95,
          "heuristicTrickyRateMax": 0.7,
          "heuristicTrickyRateBase": 0.18,
          "heuristicTrickyAggressionWeight": 0.34,
          "heuristicTrickyGreedWeight": 0.16,
          "heuristicFallbackBluffRiskMultiplier": 0.72,
          "opportunityTruthCount": 5,
          "opportunityTruthMaxCount": 6,
          "opportunityTruthClearHandAfterThreshold": 1,
          "opportunityTrapMinCount": 2,
          "opportunitySmuggleMinMovedCards": 2,
          "opportunitySmuggleMaxClaimCount": 4,
          "opportunitySmuggleLowHandAfterThreshold": 2,
          "opportunityForceLastCard": true,
          "opportunityForceNoTruthBluff": true,
          "opportunityForcePlayableTrickBone": true,
          "scoredBluffCandidateMaxCount": 4,
          "riskThresholdPressureBase": 0.5,
          "riskThresholdPressureWeight": 1.8,
          "riskReadPressureBase": 0.5,
          "riskReadPressureWeight": 1.6,
          "riskThresholdBlend": 0.72,
          "riskReadBlend": 0.28,
          "riskBluffExposureBase": 0.26,
          "riskBluffExposureMaxBonus": 0.24,
          "riskBluffExposureCardWeight": 0.06,
          "riskDifficultyNoiseMax": 0.12,
          "riskDifficultyNoiseWeight": 0.35,
          "scoreConcedeBase": 0.08,
          "scoreConcedeAffordableBonus": 0.08,
          "scoreConcedeBrokePenalty": -0.28,
          "scoreConcedeNoTruthBase": 0.28,
          "scoreConcedeNoTruthHonestyWeight": 0.18,
          "scoreConcedeTruthAvailablePenalty": -0.35,
          "scoreConcedeAggressionPenaltyWeight": 0.16,
          "scoreTruthBase": 0.62,
          "scoreTruthHonestyWeight": 0.36,
          "scoreBluffBase": 0.2,
          "scoreBluffAggressionWeight": 0.44,
          "scoreBluffGreedWeight": 0.18,
          "scoreTruthCountBase": 0.16,
          "scoreTruthCountGreedWeight": 0.06,
          "scoreBluffCountBase": 0.08,
          "scoreBluffCountAggressionWeight": 0.04,
          "scoreLowHandAfterThreshold": 2,
          "scoreLowHandAfterOpportunity": 0.35,
          "scoreClearOpportunityBase": 0.72,
          "scoreClearOpportunityGreedWeight": 0.22,
          "scoreClearOpportunityLowChipThreshold": 3,
          "scoreClearOpportunityLowChipBonus": 0.18,
          "scoreLowChipTruthThreshold": 2,
          "scoreLowChipTruthBonus": 0.14,
          "scoreHighChipBluffThreshold": 8,
          "scoreHighChipBluffBaseBonus": 0.08,
          "scoreHighChipBluffAggressionBonusWeight": 0.06,
          "scoreTruthLimitedRankBonus": 0.12,
          "scoreTruthWildLowHandAfterThreshold": 1,
          "scoreTruthWildLowHandPenalty": 0.02,
          "scoreTruthWildPenaltyBase": 0.11,
          "scoreTruthWildHonestyPenaltyWeight": 0.08,
          "scoreBluffWildPenalty": 0.2,
          "scoreTruthRiskPenaltyWeight": 0.28,
          "scoreBluffRiskPenaltyBase": 0.88,
          "scoreBluffRiskHonestyPenaltyWeight": 0.3,
          "scoreLargeBluffCountThreshold": 3,
          "scoreLargeBluffPenalty": 0.08,
          "scoreAllWildsVisibleBluffPenalty": 0.06,
          "scoreRandomBonusMax": 0.035
        },
        "foldPressure": {
          "base": 0.5,
          "challengeWinWeight": 0.06,
          "challengeWinMaxPenalty": 0.2,
          "challengeLossWeight": 0.04,
          "challengeLossMaxBonus": 0.12,
          "courageWeight": 0.32,
          "suspicionWeight": 0.12,
          "overSuspectPenalty": 0.06,
          "lowChipThreshold": 2,
          "lowChipBonus": 0.08,
          "highChipThreshold": 8,
          "highChipPenalty": 0.04,
          "stakePressureMax": 0.14,
          "stakePressureWeight": 0.05,
          "min": 0.05,
          "max": 0.95
        },
        "betting": {
          "neutralConfidence": 0.5,
          "defaultFoldFloor": 0.32,
          "bankrollBoostMax": 0.18,
          "bankrollBoostDivisor": 40,
          "couragePushWeight": 0.22,
          "randomNudgeMultiplier": 2,
          "foldFloorCourageWeight": 0.18,
          "readSuspicionWeight": 0.18,
          "challengerFoldPressureWeight": 0.45,
          "bluffStreakRaiseDriveMax": 0.12,
          "bluffStreakRaiseDriveWeight": 0.05,
          "negativeSuspicionRaisePenaltyMax": 0.14,
          "negativeSuspicionRaisePenaltyWeight": 0.2,
          "defenderTruthFoldPressureWeight": 0.34,
          "defenderTruthAggressionWeight": 0.12,
          "defenderTruthStakePressureMax": 0.12,
          "defenderTruthStakePressureWeight": 0.04,
          "defenderTruthConfidenceBonus": 0.06,
          "defenderBluffFoldPressureWeight": 0.58,
          "defenderBluffSteadinessPenaltyWeight": 0.2,
          "defenderBluffCourageWeight": 0.16,
          "defenderBluffFoldFloorBonus": 0.06,
          "confidenceMin": 0.05,
          "confidenceMax": 0.95,
          "raiseDriveMin": 0.05,
          "raiseDriveMax": 0.98,
          "foldFloorMin": 0.08,
          "foldFloorMax": 0.7,
          "raiseThresholdBase": 0.68,
          "raiseThresholdCourageWeight": 0.18,
          "hardRaiseThresholdBonus": 0.08,
          "raiseCandidateConfidenceWeight": 0.18,
          "underRaiseMistakeMultiplier": 0.75
        }
      },
      /*
       * AI difficulty ranks
       *
       * Normalized field names are game.ai.defaultDifficultyRank,
       * game.ai.difficultyRanks, game.ai.seatDifficultyRanks, and
       * game.ai.renownDisplay. The
       * normalizer ships with the rank IDs "easy", "normal", and "hard"
       * and also preserves custom entries in difficultyRanks, such as the
       * sample "boss" profile below. Unknown referenced rank IDs fall back to
       * defaultDifficultyRank, and an unknown or missing defaultDifficultyRank
       * falls back to "normal".
       *
       * defaultDifficultyRank applies to every non-human seat unless that
       * player's difficultyRank is already set or a seatDifficultyRanks entry
       * matches the seat. seatDifficultyRanks keys may be absolute seat IDs
       * ("1", "2", "3") or NPC-order aliases ("0", "npc:0",
       * "npc0", "ai:0", "ai0"). renownDisplay maps each hidden
       * difficulty rank to a visible renown level rendered in AI player seats.
       *
       * Rank profiles affect:
       * - turn choice: "easy" uses the naive playbook, "normal" uses the
       *   heuristic playbook, and "hard" uses scored candidate selection;
       * - challenge choice: challengeThreshold plus challengeThresholdModifier
       *   sets the final suspicion threshold, while cardCountingAccuracy controls
       *   how reliably an NPC tracks deck, hand, wild, and rank availability;
       *   challengeKnownCardWeight,
       *   challengeReadMemoryWeight, challengeHumanTargetBias, and
       *   challengeRandomNudgeMax shape suspicion;
       * - betting: bettingConfidenceSuspicionWeight,
       *   bettingConfidenceRandomNudgeMax, bettingFoldFloorAdjustment,
       *   bettingRaiseDriveAdjustment, bettingOpponentFoldPressureWeight,
       *   bettingRaiseScoreGate, and bettingRaiseMistakeChance shape fold/call/
       *   raise intent;
       * - delay/randomness: difficulty profile random nudge fields affect
       *   challenge and betting uncertainty; actual turn/challenge/betting wait
       *   times are controlled by game.timers.aiDecisionDelays and
       *   game.ai.decision.delays.
       *
       * Minimal override example:
       *   "defaultDifficultyRank": "hard",
       *   "seatDifficultyRanks": { "2": "easy", "3": "boss" },
       *   "difficultyRanks": {
       *     "hard": { "challengeThresholdModifier": -0.04 },
       *     "boss": { "extends": "hard", "challengeThresholdModifier": -0.08 }
       *   }
       */
      "challengeThreshold": 0.52,
      "challengeRandomNudgeMax": 0.16,
      "cardCountingAccuracy": 0.65,
      "bettingConfidenceSuspicionWeight": 0.55,
      "defaultDifficultyRank": "normal",
      "difficultyRanks": {
        "easy": {
          "challengeThreshold": 0.64,
          "challengeRandomNudgeMax": 0.22,
          "cardCountingAccuracy": 0.35,
          "bettingConfidenceSuspicionWeight": 0.42
        },
        "normal": {
          "challengeThreshold": 0.52,
          "challengeRandomNudgeMax": 0.16,
          "cardCountingAccuracy": 0.65,
          "bettingConfidenceSuspicionWeight": 0.55
        },
        "hard": {
          "challengeThreshold": 0.44,
          "challengeRandomNudgeMax": 0.08,
          "cardCountingAccuracy": 0.9,
          "bettingConfidenceSuspicionWeight": 0.68
        },
        "boss": {
          "extends": "hard",
          "challengeThresholdModifier": -0.08,
          "challengeRandomNudgeMax": 0.035,
          "challengeKnownCardWeight": 0.38,
          "challengeReadMemoryWeight": 1.45,
          "challengeHumanTargetBias": 0.14,
          "bettingConfidenceSuspicionWeight": 0.82,
          "bettingConfidenceRandomNudgeMax": 0.015,
          "bettingFoldFloorAdjustment": 0.04,
          "bettingRaiseDriveAdjustment": -0.035,
          "bettingOpponentFoldPressureWeight": 1.35,
          "bettingRaiseScoreGate": 0.14,
          "bettingRaiseMistakeChance": 0
        }
      },
      "renownDisplay": {
        "enabled": true,
        "separator": " · ",
        "fallbackLabel": "Renown",
        "levels": {
          "easy": {
            "label": "Renown I",
            "title": "Greenhorn",
            "ariaLabel": "AI difficulty: Renown I, Greenhorn"
          },
          "normal": {
            "label": "Renown II",
            "title": "Seasoned",
            "ariaLabel": "AI difficulty: Renown II, Seasoned"
          },
          "hard": {
            "label": "Renown III",
            "title": "Notorious",
            "ariaLabel": "AI difficulty: Renown III, Notorious"
          },
          "boss": {
            "label": "Renown IV",
            "title": "Bone Boss",
            "ariaLabel": "AI difficulty: Renown IV, Bone Boss"
          }
        }
      },
      "seatDifficultyRanks": {
        "1": "normal",
        "2": "normal",
        "3": "normal"
      },
      "bossEncounters": [
        {
          "boss": {
            "name": "Rotfang",
            "difficultyRank": "boss",
            "appearance": {
              "speciesId": "mao-ao",
              "gender": "male",
              "cosmetics": {
                "hairFront": "appearance::Mao-ao_M::mao-ao_tuft",
                "hairBack": "appearance::Mao-ao_M::mao-ao_long_ponytail",
                "eyes": "appearance::Mao-ao_M::mao-ao_circled_eyes",
                "facialHair": "appearance::Mao-ao_M::mao-ao_wildbeard"
              },
              "bodyColors": {
                "A": { "h": 30, "s": -0.6, "v": -0.15 },
                "B": { "h": -70, "s": -0.8, "v": -0.55 },
                "C": { "h": 30, "s": -0.5499999999999999, "v": 0.03 }
              }
            },
            "equippedCosmetics": [
              "appearance::hat::basic_headband",
              "tankan_bodywrap"
            ],
            "appliedDyes": {
              "HOOD": "dye:CLOTH:deep_green",
              "HOOD_B": "dye:CLOTH:deep_green_blue",
              "CLOTH": "dye:CLOTH:shadow_red",
              "HAT": "dye:CLOTH:deep_blue"
            },
            "trickBoneLoadout": ["trap", "trap", "trap", "smuggle", "smuggle", "smuggle"]
          },
          "ads": [
            { "name": null, "difficultyRank": "easy" },
            { "name": null, "difficultyRank": "easy" }
          ]
        }
      ]
    },
    "tutorial": {
      "ringPadPx": 9,
      "minVisibleAreaRatio": 0.55,
      "panelEdgePaddingPx": 20
    },
    "layout": {
      "mode": "authored",
      "animation": {
        "baseDurationMs": 160,
        "fadeInSpeed": 3.4,
        "fadeOutSpeed": 3.0,
        "cardCloneLayering": {
          "belowLightingZIndex": 1,
          "aboveLightingZIndex": 9999,
          "sidebarBoundarySelector": "#aiSidebar"
        }
      },
      "punishBoneSpin": {
        "spinDurationMs": 720,
        "reducedMotionSpinDurationMs": 7200,
        "rotationTurns": 1,
        "blurPx": 1.4,
        "scaleXMin": 0.56,
        "shadowBlurPx": 12
      },
      "viewport": {
        "widthPx": 1920,
        "heightPx": 1080
      },
      "diagnostics": {
        "renderedScreenSpaceParity": {
          "maxAbsDx": 0.5,
          "maxAbsDy": 0.5,
          "maxAbsDw": 0.5,
          "maxAbsDh": 0.5,
          "maxElementMagnitude": 3,
          "maxGroupAverageMagnitude": 2,
          "maxGroupMagnitude": 5,
          "requireTransformMatchFor": ["avatars", "claim avatars"],
          "requireTransformMatchForSelectors": ["avatar-*", "claim-avatar-*", "claim-text-*"],
          "transformMismatchPolicy": "warn"
        }
      },
      "authored": {
        "enabled": true,
        "designWidthPx": 1600,
        "designHeightPx": 900,
        "scaleMode": "contain",
        "boxes": {
          "topbar":         { "x": -2,   "y": 11,  "width": 1123, "height": 106 },
        "sidebar":        { "x": 1354, "y": 14,  "width": 251,  "height": 681 },
          "humanSeat":      { "x": 1260, "y": 701, "width": 373,  "height": 187 },
          "hand":           { "x": 469,  "y": 701, "width": 508,  "height": 199 },
          "log":            { "x": 7,   "y": 680, "width": 477, "height": 220  },
          "turnSpotlight":  { "x": 1122, "y": 12,  "width": 230,  "height": 200 },
          "claimCluster":   { "x": 187,  "y": 290, "width": 1037, "height": 275 },
          "challengePrompt":{ "x": 960,  "y": 760, "width": 280,  "height": 140 }
        },
        "subOffsets": {
          "betting-left-contribution-anchor": { "dx": 260, "dy": 150 },
          "betting-tier-buttons": { "dx": 8, "dy": 4 },
          "betting-right-contribution-anchor": { "dx": -260, "dy": 150 },
          "betting-choice-anchor": { "dx": -385, "dy": -40 },
          "claim-pool-pile": { "dx": -200, "dy": -100 }
        },
        "subSizes": {
          "betting-right-contribution-anchor": { "width": 92, "height": 114 },
          "betting-left-contribution-anchor": { "width": 92, "height": 114 }
        }
      },
      "cards": {
        "baseScale": 0.75,
        "stationaryScreenSpacePx": {
          "width": 43,
          "height": 82,
          "referenceWidthPx": 86
        },
        "deckPlaceholderPx": {
          "stackWidth": 136,
          "stackHeight": 192,
          "labelGap": 10,
          "referenceCardWidthPx": 58,
          "cards": [
            { "left": 32, "top": 24, "width": 116, "height": 168, "opacity": 0.55, "brightness": 0.82 },
            { "left": 18, "top": 12, "width": 116, "height": 168, "opacity": 0.75, "brightness": 0.9 },
            { "left": 4, "top": 0, "width": 116, "height": 168, "opacity": 1, "brightness": 1 }
          ]
        }
      },
      "sizing": {
        "sidebarWidthFrac": 0.15,
        "sidebarWidthPx": 280,
        "appGapPx": 8,
        "appPaddingPx": 8,
        "seatAvatarPx": 108,
        "humanSeatAvatarPx": 204,
        "cinematicAvatarPx": 132,
        "handCardMinWidthPx": 86,
        "handCardMaxWidthPx": 86,
        "handCardMinHeightPx": 164,
        "handCardMaxHeightPx": 164,
        "handCardGapMinPx": 6,
        "handCardGapMaxPx": 6,
        "eventLogMaxHeightPx": 78,
        "controlsPaddingYpx": 12,
        "controlsPaddingXpx": 12,
        "controlsGapPx": 10,
        "handWrapPaddingYpx": 8,
        "handWrapPaddingXpx": 12,
        "handWrapGapPx": 6,
        "handRailGapPx": 8,
        "handSelectedLiftPx": 12,
        "handCardArtVisualCenterOffsetPx": 4,
        "handCardContainerWidthOffsetPx": 4,
        "handCardLabelInsetLeftPx": 2,
        "handCardLabelInsetBottomPx": 2,
        "eventLogPaddingYpx": 8,
        "eventLogPaddingXpx": 12,
        "eventLogGapPx": 6,
        "logItemPaddingYpx": 9,
        "logItemPaddingXpx": 10,
        "seatInfoPaddingYpx": 6,
        "seatInfoPaddingXpx": 8,
        "challengePanePaddingYpx": 8,
        "challengePanePaddingXpx": 10
      },
      "seats": {
        "responsiveScale": {
          "enabled": true,
          "minScale": 0.56,
          "maxScale": 1,
          "sidebarReferenceWidthPx": 251,
          "sidebarReferenceHeightPx": 681,
          "sidebarReferenceSeatCount": 3,
          "humanReferenceWidthPx": 373,
          "humanReferenceHeightPx": 187
        },
        "typography": {
          "nameFontRem": 1.56,
          "metaFontRem": 0.68,
          "statusFontRem": 0.68,
          "titleFontRem": 0.95,
          "letterSpacingEm": 0.10,
          "lineHeight": 1.25
        },
        "spacing": {
          "sidebarGapPx": 8,
          "seatGapPx": 8,
          "seatPaddingPx": 9,
          "seatMetaMarginTopPx": 4,
          "seatStatusMarginTopPx": 6,
          "handPreviewGapPx": 2,
          "handPreviewMarginTopPx": 5,
          "handPreviewCardWidthPx": 10,
          "titlePaddingTopScale": 0.67,
          "titlePaddingXScale": 1.11,
          "titlePaddingBottomScale": 0.22,
          "humanPaddingScale": 1.33,
          "humanGapScale": 1.25,
          "avatarMaxWidthPct": 52
        }
      },
      "hand": {
        "desiredHeightFrac": 0.2,
        "desiredWidthFrac": 0.5,
        "heightScale": 0.5,
        "minHeightPx": 160,
        "maxHeightPx": 360,
        "visible": true,
        "panel": {
          "background": "transparent",
          "border": "0",
          "outline": "none",
          "shadow": "none"
        },
        "forceAllVisible": true,
        "compact": {
          "enabled": true,
          "cardMinWidthPx": 64,
          "cardGapPx": 6,
          "cardMinHeightPx": 128
        }
      },
      "tableView": {
        "desiredHeightFrac": 0.58,
        "minDominanceFrac": 0.56,
        "minHeightPx": 260,
        "maxHeightPx": 680,
        "cardVisualMode": "faceDown",
        "turnSpotlight": {
          "embedded": true,
          "pinCorner": "top-right",
          "offsetXPx": 10,
          "offsetYPx": 10
        },
        "visualFit": {
          "tableCardContainerScale": 1.25,
          "tableCardContentScale": 1,
          "claimAvatarSizePx": 270,
          "claimAvatarZoomScale": 1.2,
          "claimAvatarBorderRadiusPx": 12,
          "claimAvatarBorderColor": "transparent",
          "claimAvatarBackground": "transparent",
          "claimAvatarFirstNameOffsetPx": 26,
          "claimAvatarFirstNameFontRem": 1.34,
          "avatarAdditiveZoomScale": 1.2,
          "claimAvatarOverlayZIndex": 9990
        },
        "cinematic": {
          "enabled": true,
          "showEffects": true,
          "showAvatars": false,
          "playerInfoOffsetPx": 12,
          "playerInfoFontRem": 1.05,
          "claimTitleOffsetYPx": -150,
          "betControlsOffsetYPx": 150,
          "claimTitleScale": 1.5,
          "betActionBurstFontRem": 2,
          "betActionBurstDurationSec": 2.1,
          "liarBurstFontRem": 3.2,
          "liarBurstDurationSec": 3.2,
          "liarBurstEndYPct": -180,
          "liarBurstOffsetXPx": -232,
          "betActionBurstClampInsetPx": 24,
          "revealDurationMs": 4200,
          "foldDurationMs": 2600,
          "tankanColumns": {
            "enabled": true,
            "fallbackAvatarHalfWidthPx": 132,
            "fallbackAvatarCenterOffsetYPx": 100,
            "edgeInsetPx": 10,
            "minGapPx": 16,
            "gapWidthRatio": 0.015,
            "fontSize": "clamp(1.4rem, 3vw, 3.2rem)",
            "letterSpacing": "0.08em",
            "color": "var(--accent-2)",
            "textShadow": "0 2px 8px rgba(0,0,0,0.72)",
            "initialOpacity": 0,
            "opacity": 0.92,
            "animationEnabled": true,
            "animation": "cinTankanRise 260ms ease-out both",
            "riseOffset": "12px",
            "zIndex": 10012
          }
        }
      },
      "regions": {
        "actionFocus": {
          "enabled": false,
          "replaceWithFloatingClaimCluster": true
        },
        "turnSpotlight": {
          "enabled": true,
          "mustStayVisible": true,
          "avatarSizePx": 180,
          "nameBarBelowAvatar": true
        },
        "contextBox": {
          "enabled": true,
          "sharedDeclareAndChallengeSlot": true,
          "mustStayVisible": true
        },
        "log": {
          "enabled": true
        }
      },
      "claimCluster": {
        "enabled": true,
        "anchor": "tableView",
        "scaleAsOne": true,
        "preserveRelativePositions": true,
        "mustStayVisible": true,
        "transparentShells": true,
        "geometry": {
          "centerXPct": 0.5,
          "centerYPct": 0.5,
          "widthPctOfTableView": 1.0,
          "heightPctOfTableView": 1.0
        },
        "elements": {
          "claimRankBox": {
            "xPct": 0.5,
            "yPct": 0.115385,
            "wPct": 0.0625,
            "hPct": 0.230769
          },
          "claimHandBar": {
            "xPct": 0.5,
            "yPct": 0.538462,
            "wPct": 0.5,
            "hPct": 0.461538
          },
          "actorAvatarFloat": {
            "xPct": 0.0625,
            "yPct": 0.538462,
            "wPct": 0.125,
            "hPct": 0.461538
          },
          "reactorAvatarFloat": {
            "xPct": 0.9375,
            "yPct": 0.538462,
            "wPct": 0.125,
            "hPct": 0.461538
          },
          "claimTimesBoxLeft": {
            "xPct": 0.1875,
            "yPct": 0.538462,
            "wPct": 0.041667,
            "hPct": 0.153846
          },
          "claimCountBoxLeft": {
            "xPct": 0.1875,
            "yPct": 0.846154,
            "wPct": 0.083333,
            "hPct": 0.307692
          },
          "claimTimesBoxRight": {
            "xPct": 0.8125,
            "yPct": 0.538462,
            "wPct": 0.041667,
            "hPct": 0.153846
          },
          "claimCountBoxRight": {
            "xPct": 0.8125,
            "yPct": 0.846154,
            "wPct": 0.083333,
            "hPct": 0.307692
          },
          "cinematicPane": {
            "xPct": 0.5,
            "yPct": 0.66,
            "wPct": 0.5,
            "hPct": 0.28
          }
        }
      },
      "shells": {
        "transparentFloatingBoxes": true,
        "disablePanelChromeForFloatingBoxes": true
      },
      "controlsToHandRelationship": "below",
      "actionColumn": {
        "heightScale": 0.25
      },
      "controls": {
        "heightScale": 0.5
      },
      "betting": {
        "titleOffsetY": "-80%",
        "choiceOffsetY": "115%",
        "leftSlotOffsetX": "260px",
        "leftSlotOffsetY": "150px",
        "rightSlotOffsetX": "-260px",
        "rightSlotOffsetY": "150px",
        "coinButtonSize": "clamp(58px, 8.6vw, 86px)",
        "contributionCoinSize": "clamp(48px, 6.7vw, 72px)",
        "tierGap": "clamp(10px, 2.2vw, 20px)"
      },
      "allowChallengeOverflow": true,
      "background": {
        "tabletopImageSrc": "./docs/assets/hud/tabletop.png"
      },
      "lighting": {
        "flame": {
          "enabled": false,
          "xPct": 0.5,
          "yPct": 0.14,
          "coreAlpha": 0.4,
          "midAlpha": 0.27,
          "farAlpha": 0.14,
          "flickerSeconds": 2.9
        },
        "cardShadow": {
          "offsetXPx": 1.5,
          "offsetYPx": 9,
          "blurPx": 12,
          "spreadPx": -2,
          "alpha": 0.34,
          "contactAlpha": 0.2
        },
        "candlelight": {
          "radiusRefPx": 1200,
          "sources": [
            {
              "xPct": 0.0317708333,
              "yPct": 0.3333333333,
              "intensity": 0.77,
              "radiusMultiplier": 1,
              "flickerSpeed": 4.17,
              "turbulence": 1
            },
            {
              "xPct": 1.18,
              "yPct": 0.3333333333,
              "intensity": 0.77,
              "radiusMultiplier": 1,
              "flickerSpeed": 4.17,
              "turbulence": 1
            }
          ],
          "backlitAlphaDefault": 0.14,
          "thevmenuOpacity": 0.35,
          "thevmenuLayerZIndex": 2147483646,
          "backlitBlurDefault": 0,
          "masking": {
            "gatherCadenceMs": 100,
            "debugImmuneMasks": false,
            "textMaskPaddingPx": 1
          },
          "selectorDefaults": {
            "#aiSidebar": { "backlit": false, "immune": false },
            ".humanSeatZone": { "backlit": false, "immune": false },
            ".turnSpotlight": { "backlit": false, "immune": false },
            ".seatAvatarBox": { "backlit": false, "immune": false },
            ".turnSpotlightAvatar": { "backlit": false, "immune": false },
            ".cin-avatar": { "backlit": false, "immune": false },
            ".seatName": { "backlit": false, "immune": false },
            ".seatMeta": { "backlit": false, "immune": false },
            ".seatStatus": { "backlit": false, "immune": false },
            ".turnSpotlightNameBar": { "backlit": false, "immune": false },
            ".cin-name": { "backlit": false, "immune": false },
            "[data-stake-left-contribution-anchor]": { "backlit": false, "immune": false },
            "[data-stake-right-contribution-anchor]": { "backlit": false, "immune": false },
            "[data-stake-betting-choice-anchor]": { "backlit": false, "immune": false },
            ".stakeTierBtnRow": { "backlit": true, "immune": false },
            ".handWrap": { "backlit": false, "immune": false }
          },
          "selectorGroups": {
            "backlit": {
              "container": ["#aiSidebar", ".humanSeatZone", ".turnSpotlight"],
              "avatar": [".seatAvatarBox", ".turnSpotlightAvatar", ".cin-avatar"],
              "text": [".seatName", ".seatMeta", ".seatChipBadge", ".seatChipBadgeIcon", ".seatStatus", ".turnSpotlightNameBar", ".cin-name"],
              "sub": ["[data-stake-left-contribution-anchor]", "[data-stake-right-contribution-anchor]", "[data-stake-betting-choice-anchor]", ".stakeTierBtnRow"]
            },
            "immuneCapable": {
              "container": ["#aiSidebar", ".humanSeatZone", ".turnSpotlight"],
              "avatar": [".seatAvatarBox", ".turnSpotlightAvatar", ".cin-avatar"],
              "text": [".seatName", ".seatMeta", ".seatChipBadge", ".seatChipBadgeIcon", ".seatStatus", ".turnSpotlightNameBar", ".cin-name"],
              "sub": ["[data-stake-left-contribution-anchor]", "[data-stake-right-contribution-anchor]", "[data-stake-betting-choice-anchor]", ".stakeTierBtnRow"]
            }
          },
          "projectionMappings": {
            "sidebar": {
              "container": ["#aiSidebar"],
              "avatar": ["#aiSidebar .seatAvatarBox"],
              "text": ["#aiSidebar .seatName", "#aiSidebar .seatMeta", "#aiSidebar .seatChipBadge", "#aiSidebar .seatChipBadgeIcon", "#aiSidebar .seatStatus"]
            },
            "human-seat-zone": {
              "container": [".humanSeatZone"],
              "avatar": [".humanSeatZone .seatAvatarBox"],
              "text": [".humanSeatZone .seatName", ".humanSeatZone .seatMeta", ".humanSeatZone .seatChipBadge", ".humanSeatZone .seatChipBadgeIcon", ".humanSeatZone .seatStatus"]
            },
            "turn-spotlight": {
              "container": [".turnSpotlight"],
              "avatar": [".turnSpotlightAvatar"],
              "text": [".turnSpotlightNameBar", ".cin-name"]
            },
            "betting-left-contribution-anchor": {
              "sub": ["[data-stake-left-contribution-anchor]"]
            },
            "betting-right-contribution-anchor": {
              "sub": ["[data-stake-right-contribution-anchor]"]
            },
            "betting-choice-anchor": {
              "sub": ["[data-stake-betting-choice-anchor]"]
            },
            "betting-tier-buttons": {
              "sub": [".stakeTierBtnRow"]
            },
            "avatar-*": {
              "sub": ["[data-proj-id=\"{projId}\"]"]
            }
          },
          "targets": {
            "backlit": {
              "container": ["#aiSidebar", ".humanSeatZone", ".turnSpotlight"],
              "avatar": [".seatAvatarBox", ".turnSpotlightAvatar", ".cin-avatar"],
              "text": [".seatName", ".seatMeta", ".seatChipBadge", ".seatChipBadgeIcon", ".seatStatus", ".turnSpotlightNameBar", ".cin-name"],
              "sub": ["[data-stake-left-contribution-anchor]", "[data-stake-right-contribution-anchor]", "[data-stake-betting-choice-anchor]", ".stakeTierBtnRow"]
            },
            "immuneCapable": {
              "container": ["#aiSidebar", ".humanSeatZone", ".turnSpotlight"],
              "avatar": [".seatAvatarBox", ".turnSpotlightAvatar", ".cin-avatar"],
              "text": [".seatName", ".seatMeta", ".seatChipBadge", ".seatChipBadgeIcon", ".seatStatus", ".turnSpotlightNameBar", ".cin-name"],
              "sub": ["[data-stake-left-contribution-anchor]", "[data-stake-right-contribution-anchor]", "[data-stake-betting-choice-anchor]", ".stakeTierBtnRow"]
            }
          },
          "projectionRoles": {
            "sidebar": {
              "container": ["#aiSidebar"],
              "avatar": ["#aiSidebar .seatAvatarBox"],
              "text": ["#aiSidebar .seatName", "#aiSidebar .seatMeta", "#aiSidebar .seatChipBadge", "#aiSidebar .seatChipBadgeIcon", "#aiSidebar .seatStatus"]
            },
            "human-seat-zone": {
              "container": [".humanSeatZone"],
              "avatar": [".humanSeatZone .seatAvatarBox"],
              "text": [".humanSeatZone .seatName", ".humanSeatZone .seatMeta", ".humanSeatZone .seatChipBadge", ".humanSeatZone .seatChipBadgeIcon", ".humanSeatZone .seatStatus"]
            },
            "turn-spotlight": {
              "container": [".turnSpotlight"],
              "avatar": [".turnSpotlightAvatar"],
              "text": [".turnSpotlightNameBar", ".cin-name"]
            },
            "betting-left-contribution-anchor": {
              "sub": ["[data-stake-left-contribution-anchor]"]
            },
            "betting-right-contribution-anchor": {
              "sub": ["[data-stake-right-contribution-anchor]"]
            },
            "betting-choice-anchor": {
              "sub": ["[data-stake-betting-choice-anchor]"]
            },
            "betting-tier-buttons": {
              "sub": [".stakeTierBtnRow"]
            },
            "avatar-*": {
              "sub": ["[data-proj-id=\"{projId}\"]"]
            }
          }
        }
      },
      "layerManager": {
        "enabled": true,
        "hostZIndex": 45,
        "defaultPreserveSpace": true,
        "normalizePromotedElementBox": true,
        "useVisualPortalRectSelectors": [".claimClusterTextAnchor"],
        "preservePromotionTransformSelectors": [
          ".seatAvatarBox",
          ".turnSpotlightAvatar",
          ".cin-avatar",
          ".claimClusterTextAnchor",
          ".claimAvatarNameTag",
          ".claimAvatarCinRole",
          ".claimAvatarCinName",
          ".claimAvatarCinTags"
        ],
        "disablePreservePromotionTransformSelectors": [],
        "transformSensitiveMarkerAttributes": [
          "id",
          "class",
          "data-proj-id",
          "data-ui-role",
          "data-node-type",
          "data-cinematic"
        ],
        "transformSensitiveMarkerTerms": [
          "avatar",
          "portrait",
          "cinematic",
          "cutscene"
        ],
        "preservePromotionTransformProjectIds": [
          "avatar-human"
        ],
        "preservePromotionTransformProjectIdPrefixes": [
          "avatar-",
          "claim-avatar-"
        ],
        "preservePromotionTransformProjectIdContainsRules": [
          {
            "prefix": "claim-",
            "contains": [
              "anchor",
              "text"
            ]
          }
        ],
        "typographyBaselineRootSelector": "#app",
        "typographyBaselineFields": [
          "font-size",
          "line-height",
          "font-family",
          "letter-spacing",
          "font-weight"
        ],
        "promotedTextMetricFields": [
          "font-size",
          "line-height",
          "font-family",
          "font-weight",
          "letter-spacing",
          "text-align",
          "white-space",
          "max-width",
          "box-sizing",
          "padding-top",
          "padding-right",
          "padding-bottom",
          "padding-left"
        ],
        "promotedTextMetricAssignmentIds": [
          "ui-text-over-lighting"
        ],
        "normalizeBoxGuard": {
          "allowlistSelectors": [
            "*"
          ],
          "denylistSelectors": [
            ".challengePromptInfo",
            ".cin-name",
            ".cin-action-burst",
            ".claimAvatarNameTag",
            ".claimAvatarCinRole",
             ".claimAvatarCinName",
             ".claimAvatarCinTags",
             ".seatName",
             ".seatMeta",
             ".seatChipBadge",
             ".seatChipBadgeIcon",
             ".seatSeed",
             ".seatTags",
             ".seatCoinRow",
             ".seatStatus",
             ".seatHandPreview",
             ".seatTrickLoadoutInfo",
             ".seatTrickLoadoutInfoItem",
             ".seatTrickLoadoutGlyph",
            ".seatTrickLoadoutMultiplyGlyph",
            ".turnSpotlightNameBar",
            ".cin-result-copy",
            ".cinematic-vs-line",
            ".actorAvatarFloat",
            ".reactorAvatarFloat"
          ],
          "marginReset": {
            "allowlistSelectors": [
              "*"
            ],
            "denylistSelectors": [
              ".challengePromptInfo",
              ".cin-name",
              ".cin-action-burst",
              ".claimAvatarNameTag",
              ".claimAvatarCinRole",
               ".claimAvatarCinName",
               ".claimAvatarCinTags",
               ".seatName",
               ".seatMeta",
               ".seatChipBadge",
               ".seatChipBadgeIcon",
               ".seatSeed",
               ".seatTags",
               ".seatCoinRow",
               ".seatStatus",
               ".seatHandPreview",
               ".seatTrickLoadoutInfo",
               ".seatTrickLoadoutInfoItem",
               ".seatTrickLoadoutGlyph",
              ".seatTrickLoadoutMultiplyGlyph",
              ".turnSpotlightNameBar",
              ".cin-result-copy",
              ".cinematic-vs-line",
              ".actorAvatarFloat",
              ".reactorAvatarFloat"
            ]
          },
          "fillSize": {
            "allowlistSelectors": [
              "*"
            ],
            "denylistSelectors": [
              ".challengePromptInfo",
              ".cin-name",
              ".cin-action-burst",
              ".claimAvatarNameTag",
              ".claimAvatarCinRole",
               ".claimAvatarCinName",
               ".claimAvatarCinTags",
               ".seatName",
               ".seatMeta",
               ".seatChipBadge",
               ".seatChipBadgeIcon",
               ".seatSeed",
               ".seatTags",
               ".seatCoinRow",
               ".seatStatus",
               ".seatHandPreview",
               ".seatTrickLoadoutInfo",
               ".seatTrickLoadoutInfoItem",
               ".seatTrickLoadoutGlyph",
              ".seatTrickLoadoutMultiplyGlyph",
              ".turnSpotlightNameBar",
              ".cin-result-copy",
              ".cinematic-vs-line",
              ".actorAvatarFloat",
              ".reactorAvatarFloat"
            ]
          }
        },
        "placementMode": "authored-space",
        "placementCoordinateSpace": "app",
        "roundToPixels": false,
        "portalScaleStrategy": "portal-transform",
        "updateOnScroll": true,
        "screenSpaceUseFixed": true,
        "screenSpaceRoundToPixels": false,
        "promoteByRootSelectors": [
          "#aiSidebar",
          ".humanSeatZone",
          ".claimCluster",
          ".stakeVisualPanel",
          ".challengePromptPane"
        ],
        "excludeDescendantSelectors": [
          ".seatName",
          ".seatMeta",
          ".seatChipBadge",
          ".seatChipBadgeIcon",
          ".seatSeed",
          ".seatTags",
          ".seatCoinRow",
          ".seatStatus",
          ".seatHandPreview",
          ".seatTrickLoadoutInfo",
          ".seatTrickLoadoutInfoItem",
          ".seatTrickLoadoutGlyph",
          ".seatTrickLoadoutMultiplyGlyph",
          ".seatAvatarBox",
          ".claimAvatarNameTag",
          ".claimAvatarCinRole",
          ".claimAvatarCinName",
          ".claimAvatarCinTags"
        ],
        "layerOrder": [
          "above-lighting-shell",
          "above-lighting-content"
        ],
        "assignments": [
          {
            "id": "ui-text-over-lighting",
            "layer": "above-lighting-content",
            "selectors": [
              ".seatName",
              ".seatMeta",
              ".seatChipBadge",
              ".seatChipBadgeIcon",
              ".seatSeed",
              ".seatTags",
              ".seatCoinRow",
              ".seatStatus",
              ".seatHandPreview",
              ".seatTrickLoadoutInfo",
              ".seatTrickLoadoutInfoItem",
              ".seatTrickLoadoutGlyph",
              ".seatTrickLoadoutMultiplyGlyph",
              ".turnSpotlightNameBar",
              ".cin-name",
              ".cin-action-burst",
              ".tiny",
              ".sectionTitle",
              ".chip",
              ".logItem",
              ".challengePromptInfo",
              ".stakeVisualHeader",
              ".stakeSlotLabel",
              ".stakeSlotValue",
              ".bettingStatusTitle",
              ".bettingStatusLine",
              ".claimAvatarNameTag",
              ".claimAvatarCinRole",
              ".claimAvatarCinName",
              ".claimAvatarCinTags",
              ".claimClusterTextAnchor",
              ".trickDeckInfo",
              ".trickDeckInfoItem",
              ".trickDeckInfoGlyph",
              ".trickDeckInfoMultiplyGlyph",
              ".cinematic-vs-line",
              ".cin-result-copy"
            ],
            "preserveSpace": true
          },
          {
            "id": "ui-avatars-over-lighting",
            "layer": "above-lighting-content",
            "selectors": [".seatAvatarBox", ".turnSpotlightAvatar", ".cin-avatar"],
            "preserveSpace": true,
            "keepOriginal": true,
            "promotedOpacity": 0.72
          },
          {
            "id": "ui-shell-over-lighting",
            "layer": "above-lighting-shell",
            "selectors": [],
            "preserveSpace": true
          }
        ]
      },
      "fitter": {
        "enabled": true,
        "reflowDebounceMs": 90,
        "overflowTolerancePx": 1,
        "minReadableFontScale": 0.72,
        "stages": [
          {
            "fontScale": 0.96,
            "imageScale": 0.95,
            "gapScale": 0.94
          },
          {
            "fontScale": 0.92,
            "imageScale": 0.9,
            "gapScale": 0.88
          },
          {
            "fontScale": 0.88,
            "imageScale": 0.86,
            "gapScale": 0.82
          },
          {
            "fontScale": 0.84,
            "imageScale": 0.82,
            "gapScale": 0.76
          },
          {
            "fontScale": 0.8,
            "imageScale": 0.78,
            "gapScale": 0.7
          },
          {
            "fontScale": 0.76,
            "imageScale": 0.74,
            "gapScale": 0.64
          }
        ],
        "targets": {
          "tableView": {
            "selector": ".tableView",
            "containmentSelector": ".tableViewCards",
            "maxStage": 4,
            "minReadableFontScale": 0.8
          },
          "actionFocus": {
            "selector": ".actionFocus",
            "containmentSelector": ".actionFocusMain",
            "maxStage": 6,
            "minReadableFontScale": 0.72
          },
          "actionColumn": {
            "selector": ".actionColumn",
            "maxStage": 4,
            "minReadableFontScale": 0.76
          },
          "contextBox": {
            "selector": ".contextBox",
            "maxStage": 5,
            "minReadableFontScale": 0.74
          },
          "turnSpotlight": {
            "selector": ".turnSpotlight",
            "maxStage": 5,
            "minReadableFontScale": 0.74
          },
          "claimCluster": {
            "selector": ".claimCluster",
            "maxStage": 4,
            "minReadableFontScale": 0.72
          },
          "sidebarSeats": {
            "selector": "#aiSidebar",
            "maxStage": 6,
            "minReadableFontScale": 0.72
          },
          "handCards": {
            "selector": ".handWrap",
            "containmentSelector": ".handScroll",
            "maxStage": 6,
            "minReadableFontScale": 0.76
          },
          "logs": {
            "selector": ".eventLog",
            "maxStage": 4,
            "minReadableFontScale": 0.78
          },
          "controls": {
            "selector": ".controls",
            "maxStage": 6,
            "minReadableFontScale": 0.78
          }
        },
        "overlap": {
          "enabled": true,
          "tolerancePx": 0,
          "criticalRegions": {
            "tableView": ".tableView",
            "controls": ".controls",
            "hand": ".handWrap",
            "actionColumn": ".actionColumn",
            "contextBox": ".contextBox",
            "log": ".eventLog",
            "sidebar": "#aiSidebar",
            "turnSpotlight": ".turnSpotlight",
            "claimCluster": ".claimCluster",
            "challenge": "#challengePromptPane"
          },
          "collapseOrder": [],
          "preserveRegions": [
            "tableView",
            "controls",
            "sidebar",
            "turnSpotlight",
            "claimCluster",
            "contextBox"
          ],
          "minContainerScale": 0.7,
          "containerScaleStep": 0.02
        }
      },
      "projectionMapping": {
        "debug": {
          "editButtonLabel": "Edit",
          "editButtonTitle": "Enable map editing: move and resize authored layout boxes or sub-elements.",
          "editButtonRightPx": 224,
          "debugStatus": "Map debug mode: touch an outlined element to read its name; enable Edit to move or resize.",
          "editStatus": "Map edit mode: drag overlays to move; use corner handles to resize.",
          "generationColors": [
            { "name": "red", "color": "rgba(255, 64, 64, 0.95)" },
            { "name": "orange", "color": "rgba(255, 148, 54, 0.95)" },
            { "name": "yellow", "color": "rgba(255, 232, 82, 0.95)" },
            { "name": "green", "color": "rgba(76, 220, 112, 0.95)" },
            { "name": "blue", "color": "rgba(84, 174, 255, 0.95)" },
            { "name": "indigo", "color": "rgba(106, 112, 255, 0.95)" },
            { "name": "violet", "color": "rgba(194, 96, 255, 0.95)" }
          ]
        },
        "editor": {
          "step": 0.01,
          "panelTitle": "Projection Vars",
          "transformsExportButtonLabel": "Toggle + Export Screen Space",
          "transformsExportButtonTitle": "Toggle preview mode, then copy literal screen-space rectangles and transforms for the active mode.",
          "sliderClamp": {
            "multiplierMin": 0,
            "multiplierMax": 5,
            "absoluteMin": -2000,
            "absoluteMax": 2000
          },
          "multiplierVarHints": [
            "scale",
            "frac",
            "ratio",
            "multiplier"
          ],
          "sizePositionVarHints": [
            "width",
            "height",
            "size",
            "scale",
            "gap",
            "padding",
            "min",
            "max",
            "offset",
            "top",
            "right",
            "bottom",
            "left",
            "x",
            "y",
            "row",
            "column",
            "frac",
            "avatar",
            "card"
          ]
        },
        "sharedVars": [
          "--layout-challenge-font-scale",
          "--layout-challenge-image-scale",
          "--layout-challenge-gap-scale",
          "--layout-fit-font-scale",
          "--layout-fit-image-scale",
          "--layout-fit-gap-scale"
        ],
        "varsByProjId": {
          "topbar": [
            "--layout-app-gap",
            "--layout-app-padding"
          ],
          "sidebar": [
            "--layout-sidebar-width",
            "--layout-sidebar-content-scale",
            "--layout-seat-avatar-size"
          ],
          "seat-*": [
            "--layout-seat-avatar-size",
            "--layout-sidebar-content-scale"
          ],
          "avatar-*": [
            "--layout-seat-avatar-size",
            "--layout-human-seat-avatar-size",
            "--layout-cinematic-avatar-size"
          ],
          "human-seat-zone": [
            "--layout-human-seat-avatar-size"
          ],
          "human-seat": [
            "--layout-human-seat-avatar-size",
            "--layout-sidebar-content-scale"
          ],
          "panel": [
            "--layout-table-dominance-frac",
            "--layout-table-view-height",
            "--layout-table-view-min-height",
            "--layout-table-view-max-height"
          ],
          "table-view": [
            "--layout-table-view-height",
            "--layout-table-view-min-height",
            "--layout-table-view-max-height",
            "--layout-card-base-scale",
            "--layout-card-scale",
            "--layout-card-table-base-width",
            "--layout-card-table-base-height",
            "--layout-card-mini-base-width",
            "--layout-card-mini-base-height",
            "--layout-table-card-auto-scale",
            "--layout-fit-additive-avatar-zoom"
          ],
          "claim-cluster": [
            "--layout-claim-cluster-center-x",
            "--layout-claim-cluster-center-y",
            "--layout-claim-cluster-width",
            "--layout-claim-cluster-height",
            "--layout-claim-avatar-size",
            "--layout-claim-avatar-zoom",
            "--layout-claim-avatar-border-radius",
            "--layout-claim-avatar-border-color",
            "--layout-claim-avatar-background"
          ],
          "claim-avatar-*": [
            "--layout-claim-avatar-size",
            "--layout-claim-avatar-zoom",
            "--layout-claim-avatar-border-radius",
            "--layout-claim-avatar-border-color",
            "--layout-claim-avatar-background"
          ],
          "claim-hand-bar": [
            "--layout-card-mini-base-width",
            "--layout-card-mini-base-height",
            "--layout-card-scale"
          ],
          "claim-rank-box": [
            "--layout-challenge-font-scale",
            "--layout-fit-font-scale"
          ],
          "claim-count-left": [
            "--layout-challenge-font-scale",
            "--layout-fit-font-scale"
          ],
          "claim-times-left": [
            "--layout-challenge-font-scale",
            "--layout-fit-font-scale"
          ],
          "claim-count-right": [
            "--layout-challenge-font-scale",
            "--layout-fit-font-scale"
          ],
          "claim-times-right": [
            "--layout-challenge-font-scale",
            "--layout-fit-font-scale"
          ],
          "cinematic": [
            "--layout-cinematic-avatar-size"
          ],
          "action-column": [
            "--layout-action-column-height-scale",
            "--layout-action-column-max-height"
          ],
          "controls": [
            "--layout-controls-height-scale",
            "--layout-controls-max-height",
            "--layout-controls-padding-y",
            "--layout-controls-padding-x",
            "--layout-controls-gap"
          ],
          "challenge-prompt": [
            "--layout-challenge-font-scale",
            "--layout-challenge-image-scale",
            "--layout-challenge-gap-scale",
            "--layout-controls-height-scale",
            "--layout-controls-max-height",
            "--layout-controls-padding-y",
            "--layout-controls-padding-x",
            "--layout-controls-gap"
          ],
          "betting-status-anchor": [
            "--layout-betting-title-offset-y"
          ],
          "betting-status-title": [
            "--layout-challenge-font-scale",
            "--layout-fit-font-scale"
          ],
          "betting-status-line": [
            "--layout-challenge-font-scale",
            "--layout-fit-font-scale"
          ],
          "betting-left-contribution-anchor": [
            "--layout-betting-left-slot-offset-x",
            "--layout-betting-left-slot-offset-y",
            "--layout-betting-contribution-coin-size"
          ],
          "betting-right-contribution-anchor": [
            "--layout-betting-right-slot-offset-x",
            "--layout-betting-right-slot-offset-y",
            "--layout-betting-contribution-coin-size"
          ],
          "betting-choice-anchor": [
            "--layout-betting-choice-offset-y"
          ],
          "betting-tier-buttons": [
            "--layout-betting-coin-button-size",
            "--layout-betting-tier-gap"
          ],
          "hand": [
            "--hand-height-frac",
            "--layout-hand-height-scale",
            "--layout-hand-min-height",
            "--layout-hand-max-height",
            "--layout-hand-max-row-height",
            "--layout-hand-card-min-width",
            "--layout-hand-card-max-width",
            "--layout-hand-card-min-height",
            "--layout-hand-card-max-height",
            "--layout-hand-card-gap-min",
            "--layout-hand-card-gap-max",
            "--layout-hand-wrap-padding-y",
            "--layout-hand-wrap-padding-x",
            "--layout-hand-wrap-gap",
            "--layout-hand-panel-background",
            "--layout-hand-panel-border",
            "--layout-hand-panel-outline",
            "--layout-hand-panel-shadow",
            "--layout-card-base-scale",
            "--layout-card-hand-scale",
            "--layout-card-scale",
            "--layout-card-hit-min-width",
            "--layout-card-hit-min-height",
            "--layout-card-label-font-base",
            "--layout-card-label-gap-base",
            "--layout-card-label-padding-y-base",
            "--layout-card-label-padding-x-base",
            "--layout-card-label-offset-base",
            "--layout-card-label-radius-base"
          ],
          "log": [
            "--layout-event-log-max-height",
            "--layout-event-log-padding-y",
            "--layout-event-log-padding-x",
            "--layout-event-log-gap",
            "--layout-log-item-padding-y",
            "--layout-log-item-padding-x",
            "--layout-log-max-row-height"
          ]
        },
        "selectorVarsByProjId": {
          "table-view": {
            ".tableViewCard, .tableViewCard img": [
              "--layout-card-base-scale",
              "--layout-card-scale",
              "--layout-card-table-base-width",
              "--layout-card-table-base-height"
            ],
            ".claimHandBar, .claimHandBar .tableViewCard, .claimHandBar .tableViewCard img": [
              "--layout-card-mini-base-width",
              "--layout-card-mini-base-height",
              "--layout-card-scale"
            ],
            ".actorAvatarFloat, .reactorAvatarFloat, .actorAvatarFloat canvas, .reactorAvatarFloat canvas, .seatPortrait": [
              "--layout-seat-avatar-size",
              "--layout-human-seat-avatar-size",
              "--layout-cinematic-avatar-size",
              "--layout-sidebar-content-scale"
            ],
            ".claimRankBox, .claimCountBoxLeft, .claimCountBoxRight, .turnSpotlightNameBar": [
              "--layout-challenge-font-scale",
              "--layout-fit-font-scale"
            ]
          },
          "sidebar": {
            ".seatAvatarBox, .seatPortrait": [
              "--layout-seat-avatar-size",
              "--layout-sidebar-content-scale"
            ],
            ".seatName, .seatMeta, .seatChipBadge, .seatStatus, .seatTrickLoadoutInfo, .seatSeed, .seatTags": [
              "--layout-sidebar-content-scale"
            ]
          },
          "seat-*": {
            ".seatAvatarBox, .seatPortrait": [
              "--layout-seat-avatar-size",
              "--layout-sidebar-content-scale"
            ],
            ".seatName, .seatMeta, .seatChipBadge, .seatStatus, .seatTrickLoadoutInfo, .seatSeed, .seatTags": [
              "--layout-sidebar-content-scale"
            ]
          },
          "human-seat": {
            ".seatAvatarBox, .seatPortrait": [
              "--layout-human-seat-avatar-size"
            ],
            ".seatName, .seatMeta, .seatStatus, .seatTrickLoadoutInfo, .humanSeatChipBadge": [
              "--layout-sidebar-content-scale"
            ]
          },
          "hand": {
            ".card, .cardArt": [
              "--layout-card-base-scale",
              "--layout-card-hand-scale",
              "--layout-card-scale",
              "--layout-hand-card-min-width",
              "--layout-hand-card-max-width",
              "--layout-hand-card-min-height",
              "--layout-hand-card-max-height",
              "--layout-card-hit-min-width",
              "--layout-card-hit-min-height"
            ],
            ".cardLabel, .cardGlyph, .cardText": [
              "--layout-card-label-font-base",
              "--layout-card-label-gap-base",
              "--layout-card-label-padding-y-base",
              "--layout-card-label-padding-x-base",
              "--layout-card-label-offset-base",
              "--layout-card-label-radius-base",
              "--layout-card-scale"
            ],
            ".handScroll": [
              "--layout-hand-card-gap-min",
              "--layout-hand-card-gap-max"
            ]
          }
        },
        "fallbackVars": [
          "--layout-app-gap",
          "--layout-app-padding",
          "--layout-sidebar-width",
          "--layout-sidebar-content-scale",
          "--layout-table-view-height",
          "--layout-table-view-min-height",
          "--layout-table-view-max-height",
          "--layout-table-dominance-frac",
          "--layout-action-column-height-scale",
          "--layout-action-column-max-height",
          "--layout-controls-height-scale",
          "--layout-controls-max-height",
          "--layout-hand-height-scale",
          "--layout-card-base-scale",
          "--layout-card-hand-scale",
          "--layout-hand-min-height",
          "--layout-hand-max-height",
          "--layout-hand-card-min-width",
          "--layout-hand-card-max-width",
          "--layout-hand-card-min-height",
          "--layout-hand-card-max-height",
          "--layout-hand-wrap-padding-y",
          "--layout-hand-wrap-padding-x",
          "--layout-hand-wrap-gap",
          "--layout-event-log-max-height",
          "--layout-log-max-row-height"
        ]
      }
    },
    "cssRootVars": {
      "--bg": "#15110f",
      "--bg2": "#221917",
      "--panel": "rgba(46, 34, 30, 0.95)",
      "--panel-soft": "rgba(67, 49, 43, 0.9)",
      "--accent": "#c89952",
      "--accent-2": "#f2d08f",
      "--danger": "#c85a5a",
      "--ok": "#66b17c",
      "--text": "rgba(255,255,255,0.9)",
      "--muted": "#cdbb9f",
      "--card": "#f8f1df",
      "--card-text": "#32231d",
      "--wild": "#f1d347",
      "--shadow": "0 10px 24px rgba(0,0,0,0.28)",
      "--radius": "18px",
      "--layout-viewport-width": "1920px",
      "--layout-viewport-height": "1080px",
      "--layout-hand-min-height": "160px",
      "--layout-hand-max-height": "360px",
      "--layout-sidebar-width": "280px",
      "--layout-app-gap": "8px",
      "--layout-app-padding": "8px",
      "--layout-seat-avatar-size": "132px",
      "--layout-human-seat-avatar-size": "204px",
      "--layout-cinematic-avatar-size": "132px",
      "--layout-tankan-edge-inset": "10px",
      "--layout-cinematic-tankan-font-size": "clamp(1.4rem, 3vw, 3.2rem)",
      "--layout-cinematic-tankan-letter-spacing": "0.08em",
      "--layout-cinematic-tankan-color": "var(--accent-2)",
      "--layout-cinematic-tankan-text-shadow": "0 2px 8px rgba(0,0,0,0.72)",
      "--layout-cinematic-tankan-initial-opacity": "0",
      "--layout-cinematic-tankan-opacity": "0.92",
      "--layout-cinematic-tankan-animation": "cinTankanRise 260ms ease-out both",
      "--layout-cinematic-tankan-rise-offset": "12px",
      "--layout-cinematic-tankan-z-index": "10012",
      "--layout-hand-card-min-width": "86px",
      "--layout-hand-card-max-width": "86px",
      "--layout-hand-card-min-height": "164px",
      "--layout-hand-card-max-height": "164px",
      "--layout-hand-card-gap-min": "6px",
      "--layout-hand-card-gap-max": "6px",
      "--layout-event-log-max-height": "78px",
      "--layout-controls-padding-y": "12px",
      "--layout-controls-padding-x": "12px",
      "--layout-controls-gap": "10px",
      "--layout-hand-wrap-padding-y": "8px",
      "--layout-hand-wrap-padding-x": "12px",
      "--layout-hand-wrap-gap": "6px",
      "--layout-hand-card-shell-width-offset": "4px",
      "--layout-hand-card-label-inset-left": "2px",
      "--layout-hand-card-label-inset-bottom": "2px",
      "--layout-hand-panel-background": "transparent",
      "--layout-hand-panel-border": "0",
      "--layout-hand-panel-outline": "none",
      "--layout-hand-panel-shadow": "none",
      "--layout-event-log-padding-y": "8px",
      "--layout-event-log-padding-x": "12px",
      "--layout-event-log-gap": "6px",
      "--layout-log-item-padding-y": "9px",
      "--layout-log-item-padding-x": "10px",
      "--layout-seat-info-padding-y": "8px",
      "--layout-seat-info-padding-x": "10px",
      "--layout-challenge-pane-padding-y": "8px",
      "--layout-challenge-pane-padding-x": "10px",
      "--layout-table-view-min-height": "260px",
      "--layout-table-view-max-height": "680px",
      "--layout-table-dominance-frac": "0.56",
      "--layout-turn-spotlight-avatar-size": "180px",
      "--layout-claim-cluster-center-x": "0.5",
      "--layout-claim-cluster-center-y": "0.54",
      "--layout-claim-cluster-width": "78",
      "--layout-claim-cluster-height": "48",
      "--layout-table-card-container-scale": "1.25",
      "--layout-table-card-content-scale": "0.8",
      "--layout-claim-avatar-size": "270px",
      "--layout-claim-avatar-zoom": "1.2",
      "--layout-claim-avatar-border-radius": "12px",
      "--layout-claim-avatar-border-color": "rgba(242,208,143,0.28)",
      "--layout-claim-avatar-background": "rgba(22,16,14,0.72)",
      "--layout-claim-title-offset-y": "-150px",
      "--layout-claim-bet-controls-offset-y": "150px",
      "--layout-claim-title-scale": "1.5",
      "--layout-betting-title-offset-y": "-80%",
      "--layout-betting-choice-offset-y": "115%",
      "--layout-betting-left-slot-offset-x": "260px",
      "--layout-betting-left-slot-offset-y": "150px",
      "--layout-betting-right-slot-offset-x": "-260px",
      "--layout-betting-right-slot-offset-y": "150px",
      "--layout-betting-coin-button-size": "clamp(58px, 8.6vw, 86px)",
      "--layout-betting-contribution-coin-size": "clamp(48px, 6.7vw, 72px)",
      "--layout-betting-tier-gap": "clamp(10px, 2.2vw, 20px)",
      "--layout-turn-spotlight-offset-x": "10px",
      "--layout-turn-spotlight-offset-y": "10px",
      "--layout-cinematic-player-info-offset": "12px",
      "--layout-cinematic-player-info-font": "2.1rem",
      "--layout-cinematic-burst-font": "2rem",
      "--layout-cinematic-burst-duration": "2.1s",
      "--layout-liar-burst-font": "3.2rem",
      "--layout-liar-burst-duration": "3.2s",
      "--layout-liar-burst-end-y": "-180%",
      "--layout-flame-x": "50%",
      "--layout-flame-y": "14%",
      "--layout-flame-core-alpha": "0.4",
      "--layout-flame-mid-alpha": "0.27",
      "--layout-flame-far-alpha": "0.14",
      "--layout-flame-flicker-seconds": "2.9s",
      "--layout-flame-enabled": "1",
      "--layout-card-shadow-offset-x": "1.5px",
      "--layout-card-shadow-offset-y": "9px",
      "--layout-card-shadow-blur": "12px",
      "--layout-card-shadow-spread": "-2px",
      "--layout-card-shadow-alpha": "0.34",
      "--layout-card-contact-alpha": "0.2",
      "--layout-trick-info-glyph-size": "14px",
      "--layout-trick-info-gap": "6px",
      "--layout-trick-info-item-gap": "4px",
      "--layout-trick-info-margin-top": "6px",
      "--layout-trick-info-letter-spacing": "0.05em",
      "--layout-trick-info-max-width": "220px",
      "--layout-trick-info-seat-amount-column-min-em": "1.2em",
      "--layout-trick-info-deck-amount-column-min-em": "1.5em",
      "--layout-trick-symbol-filter": "drop-shadow(0 1px 2px rgba(0,0,0,0.55))",
      "--layout-punish-button-card-width": "34px",
      "--layout-punish-button-card-height": "48px",
      "--layout-cinematic-punish-button-card-width": "96px",
      "--layout-cinematic-punish-button-card-height": "136px"
    },
    "uiText": {
      "initialBanner": "Open a round by selecting one or more cards, then declare a number.",
      "yourLeadBanner": "Your lead. Select cards and declare any number.",
      "pickCardWarning": "Pick at least one card before playing.",
      "challengeTimerLabel": "Auto: let it stand",
      "challengePromptTemplate": "{seat} declared {count} × {rank}. Challenge before the timer runs out, or let it stand.",
      "challengeBurstText": "LIAR!!!",
      "letStandButton": "Let it stand",
      "tableLocation": "Injimi's Underclub"
    },

    "uiWobblyOutlines": {
      "enabled": true,
      "autoColoredBackgrounds": true,
      "minBackgroundAlpha": 0.02,
      "coloredBackgroundSelectors": [
        ".topbar",
        ".chip",
        ".turnSpotlight",
        ".turnSpotlightAvatar",
        ".turnSpotlightNameBar",
        ".aiSeat",
        ".humanSeatCard",
        ".humanSeatCard .seatAvatarBox",
        ".controls",
        ".controls select",
        ".controls button",
        ".chatLogBody",
        ".handWrap",
        ".handArrow",
        ".cardLabel",
        ".cardGlyph",
        ".eventLog",
        ".chatComposerInput",
        ".chatSendBtn",
        ".stakeTierBtn",
        ".challengePromptPane",
        ".timerTrack",
        ".timerFill",
        "details.debug",
        ".cin-result",
        ".emojiReactionPanel",
        ".emojiReactionBtn"
      ],
      "backgroundOptionalSelectors": [
        ".chatLogBody"
      ],
      "activeButtonSelectors": [
        "button:not(:disabled):not([aria-disabled=\"true\"])"
      ],
      "excludedColoredBackgroundSelectors": [
        "canvas",
        "img",
        "svg",
        "[data-wobbly-outline]",
        ".emojiReactionGlyph",
        ".emojiFxGlyph",
        ".shockGlyph"
      ],
      "defaultStyle": { "color": "#000000", "lineWidth": 7.2, "step": 23, "wobble": 1.25, "seed": 101, "outset": 4 },
      "styleRules": [
        { "selector": "[data-ui-wobbly-outline=\"challenge-prompt\"], [data-ui-wobbly-outline=\"control-panel\"], [data-ui-wobbly-outline=\"betting-controls\"]", "style": { "lineWidth": 7.4, "step": 25, "wobble": 1.35, "seed": 29, "outset": 4 } },
        { "selector": ".humanSeatCard", "style": { "lineWidth": 8, "step": 25, "wobble": 1.35, "seed": 59, "outset": 4 } },
        { "selector": ".eventLog", "style": { "lineWidth": 7.2, "step": 23, "wobble": 1.25, "seed": 71, "outset": 4 } },
        { "selector": ".chatLogBody", "style": { "lineWidth": 4.2, "step": 16, "wobble": 1, "seed": 79, "outset": 2 } },
        { "selector": ".aiSeat, .topbar, .controls, .challengePromptPane", "style": { "lineWidth": 7.4, "step": 25, "wobble": 1.35, "seed": 83, "outset": 4 } },
        { "selector": "button, select, .chip, .stakeTierBtn, .cardLabel, .cardGlyph, .handArrow, .chatComposerInput", "style": { "lineWidth": 3.2, "step": 12, "wobble": 0.95, "seed": 107, "outset": 2 } }
      ]
    },
    "assets": {
      "cards": {
        "preload": {
          "enabled": true
        },
        "hudBasePath": "./docs/assets/hud/",
        "wild": {
          "src": "2DScratchBoneWild.png",
          "fallbackSrc": "2DScratchBoneWild.png"
        },
        "flipped": {
          "src": "2DScratchboneFlipped.png",
          "fallbackSrc": "2DScratchBoneFlipped.png"
        },
        "rankTemplate": {
          "src": "2DScratchbone{rank}.png",
          "fallbackSrc": "2DScratchbones{rank}.png"
        }
      },
      "symbols": {
        "claimRankGlyphTemplateSrc": "./docs/assets/symbols/boneglyph{rank}.png",
        "claimMultiplyGlyphSrc": "./docs/assets/symbols/multglyph.png",
        "trickGlyphSrc": {
          "smuggle": "./docs/assets/symbols/boneglyph_smuggle.png",
          "trap": "./docs/assets/symbols/boneglyph_trap.png",
          "punish": "./docs/assets/symbols/boneglyph_punish.png"
        }
      },
      "hud": {
        "cinematicTokenIconSrc": "./docs/assets/hud/coin_tinmoon.png",
        "coinFallbackTierId": "tinmoon",
        "claimClusterFontFamily": "\"KhymeryyanRomanLetters+Numbers\", serif",
        "claimClusterFontSrc": "./docs/assets/hud/KhymeryyanRomanLetters+Numbers.otf.ttf",
        "claimMultiplyGlyphScale": 0.5,
        "claimMultiplyGlyphInvert": true,
        "stakeTierCoinSrc": {
          "sun": "./docs/assets/hud/coin_sun.png",
          "tinmoon": "./docs/assets/hud/coin_tinmoon.png",
          "eclipse": "./docs/assets/hud/coin_eclipse.png"
        }
      },
      "audio": {
        "enabled": true,
        "sfxVolume": 0.92,
        "bgmVolume": 0.48,
        "musicFadeMs": 280,
        "movement": {
          "handToTable": { "url": "./docs/assets/audio/sfx/tablesounds/boneclack1.m4a", "pitch": 1.0, "tempo": 1.0, "volume": 0.95 },
          "tableToClaim": { "url": "./docs/assets/audio/sfx/tablesounds/boneclack1.m4a", "pitch": 1.08, "tempo": 1.0, "volume": 0.9 },
          "claimToHand": { "url": "./docs/assets/audio/sfx/tablesounds/boneclack1.m4a", "pitch": 0.92, "tempo": 0.98, "volume": 0.94 },
          "opponentToTable": { "url": "./docs/assets/audio/sfx/tablesounds/boneclack1.m4a", "pitch": 0.88, "tempo": 0.94, "volume": 0.9 },
          "fadeIn": { "url": "./docs/assets/audio/sfx/tablesounds/boneclack1.m4a", "pitch": 1.0, "tempo": 1.02, "volume": 0.78 },
          "lerpComplete": {
            "url": "./docs/assets/audio/sfx/tablesounds/boneclack1.m4a",
            "pitch": 1.0,
            "tempo": 1.0,
            "volume": 0.9,
            "leadMs": 120,
            "extraCardDelayMs": 12
          }
        },
        "challenge": {
          "start": { "url": "./docs/assets/audio/sfx/tablesounds/boneclack1.m4a", "pitch": 1.0, "tempo": 1.0, "volume": 1.0 },
          "liarBurst": { "url": "./docs/assets/audio/sfx/challenge/liarburst.mp3", "pitch": 1.0, "tempo": 1.0, "volume": 1.0 },
          "end": { "url": "./docs/assets/audio/sfx/tablesounds/boneclack1.m4a", "pitch": 1.0, "tempo": 1.0, "volume": 1.0 }
        },
        "payoutBurst": {
          "enabled": true,
          "jingles": [
            "./docs/assets/audio/sfx/tablesounds/coinjingle1.mp3",
            "./docs/assets/audio/sfx/tablesounds/coinjingle2.mp3",
            "./docs/assets/audio/sfx/tablesounds/coinjingle3.mp3"
          ],
          "spacingMinMs": 30,
          "spacingMaxMs": 70,
          "pitchCountMode": "preIncrement"
        },
        "bgm": {
          "playlist": [
            "./docs/assets/audio/bgm/tankan_nocturne.mp3"
          ],
          "challenge": "./docs/assets/audio/bgm/challengeloop_placeholder.m4a"
        },
        "voice": {
          "wordByWord": true,
          "utterances": {
            "mao-ao": {
              "basePath": "./docs/assets/audio/sfx/voice/utterances/mao-ao/",
              "prefix": "mv01_",
              "volume": 0.9,
              "laugh": "laugh.ogg",
              "cuss": "cuss.ogg",
              "ntalk": ["ntalk1.ogg", "ntalk2.ogg", "ntalk3.ogg", "ntalk4.ogg"],
              "htalk": ["htalk1.ogg", "htalk2.ogg", "htalk3.ogg", "htalk4.ogg"],
              "atalk": ["atalk1.ogg", "atalk2.ogg", "atalk3.ogg", "atalk4.ogg"]
            },
            "kenkari": {
              "basePath": "./docs/assets/audio/sfx/voice/utterances/kenkari/",
              "prefix": "kv01_",
              "volume": 0.9,
              "laugh": "laugh.ogg",
              "cuss": "cuss.ogg",
              "ntalk": ["ntalk1.ogg", "ntalk2.ogg", "ntalk3.ogg", "ntalk4.ogg"],
              "htalk": ["htalk1.ogg", "htalk2.ogg", "htalk3.ogg", "htalk4.ogg"],
              "atalk": ["atalk1.ogg", "atalk2.ogg", "atalk3.ogg", "atalk4.ogg"]
            },
            "rakakoan": {
              "basePath": "./docs/assets/audio/sfx/voice/utterances/rakakoan/",
              "prefix": "rv01_",
              "volume": 0.9,
              "laugh": "laugh.ogg",
              "cuss": "cuss.ogg",
              "ntalk": ["ntalk1.ogg", "ntalk2.ogg", "ntalk3.ogg", "ntalk4.ogg"],
              "htalk": ["htalk1.ogg", "htalk2.ogg", "htalk3.ogg", "htalk4.ogg"],
              "atalk": ["atalk1.ogg", "atalk2.ogg", "atalk3.ogg", "atalk4.ogg"]
            },
            "tletingan": {
              "basePath": "./docs/assets/audio/sfx/voice/utterances/tletingan/",
              "prefix": "tv01_",
              "volume": 0.9,
              "laugh": "laugh.ogg",
              "cuss": "cuss.ogg",
              "ntalk": ["ntalk1.ogg", "ntalk2.ogg", "ntalk3.ogg", "ntalk4.ogg"],
              "htalk": ["htalk1.ogg", "htalk2.ogg", "htalk3.ogg", "htalk4.ogg"],
              "atalk": ["atalk1.ogg", "atalk2.ogg", "atalk3.ogg", "atalk4.ogg"]
            },
            "engh-sho": {
              "basePath": "./docs/assets/audio/sfx/voice/utterances/engh-sho/",
              "prefix": "ev01_",
              "volume": 0.9,
              "laugh": "laugh.ogg",
              "cuss": "cuss.ogg",
              "ntalk": ["ntalk1.ogg", "ntalk2.ogg", "ntalk3.ogg", "ntalk4.ogg"],
              "htalk": ["htalk1.ogg", "htalk2.ogg", "htalk3.ogg", "htalk4.ogg"],
              "atalk": ["atalk1.ogg", "atalk2.ogg", "atalk3.ogg", "atalk4.ogg"]
            }
          }
        }
      },
      "portrait": {
        "assetBase": "./docs/assets/",
        "configBase": "./docs/config/"
      },
      "pngPlaneAvatar": {
        "threeModuleUrl": "https://esm.sh/three@0.165.0",
        "orbitControlsModuleUrl": "https://esm.sh/three@0.165.0/examples/jsm/controls/OrbitControls.js?deps=three@0.165.0",
        "gltfExporterModuleUrl": "https://esm.sh/three@0.165.0/examples/jsm/exporters/GLTFExporter.js?deps=three@0.165.0",
        "modelWidth": 1,
        "anchorZ": 0,
        "alphaTest": 0.001,
        "backPlaneOffsetZ": 0.001,
        "behindView": {
          "headUrls": {
            "mao-ao": {
              "male": "fightersprites/special_cases/head-behind_mao_m.png",
              "female": "fightersprites/special_cases/head-behind_mao_f.png"
            },
            "engh-sho": {
              "male": "fightersprites/special_cases/head-behind_engh_m.png",
              "female": "fightersprites/special_cases/head-behind_engh_f.png"
            }
          },
          "layerReplacements": [
            {
              "idIncludes": ["snowgoggles"],
              "genderUrls": {
                "male": "cosmetics/appearance/engh-sho-m/snowgoggles-behind_m.png",
                "female": "cosmetics/appearance/engh-sho-f/snowgoggles-behind-f.png"
              }
            },
            {
              "idIncludes": ["braidcluster-r"],
              "url": "cosmetics/appearance/shared/braidcluster-R-behind.png"
            },
            {
              "hairSlot": "back",
              "idIncludes": ["longponytail", "long-ponytail", "ponytail"],
              "url": "cosmetics/appearance/shared/longponytail-behind.png"
            },
            {
              "hairSlot": "back",
              "idIncludes": ["splayedknot"],
              "url": "cosmetics/appearance/shared/splayedknot-behind.png"
            }
          ]
        },
        "previewPortraitCanvasSize": 200,
        "previewCameraFovDeg": 45,
        "previewCameraDistance": 3.2,
        "previewGridSize": 5,
        "previewGridDivisions": 10
      }
    },

    "npcPools": {
      "kumapirran-citizens": {
        "label": "Kumapirran Citizens"
      },
      "riverlands-bandits": {
        "label": "Riverlands Bandits",
        "speciesRestriction": ["mao-ao"],
        "genderWeights": { "male": 9, "female": 1 },
        "nicknames": [
          "Scratcher", "Fang", "Claw", "Prowl", "Slink", "Hiss", "Snarl", "Pounce", "Bristle",
          "Grim", "Dagger", "Thorn", "Lash", "Snap", "Rend", "Gash", "Notch", "Crook", "Hook",
          "Squall", "Murk", "Bog", "Muck", "Slick", "Drench",
          "Mudpaw", "Mudfoot", "Longtail", "Redtail", "Shorttail",
          "Two-Fingers", "Flatnose",
          "Bronze Claw", "Bronze Fang", "Bronze Tooth",
          "Bonecutter", "Gutripper", "Riverrat", "Mangrove", "Deadwood"
        ],
        "hoodImpliesTorso": "tankan_bodywrap",
        "cosmeticOverrides": {
          "M": {
            "weights": {
              "hat":        { "basic_headband": 55, "leather_headband": 25, "none": 15, "riverlandskasa_low": 3, "riverlandskasa_wide": 2 },
              "hood":       { "fine_hood": 25, "none": 75 },
              "torso":      { "bandolier1": 70, "none": 30 },
              "facialHair": { "wildbeard": 85, "none": 15 },
              "hairSide":   { "shoulder_length_drape": 30, "braid-R": 35, "braidcluster-R": 35, "none": 0 },
              "hairSideL":  { "braid-L": 90, "none": 10 }
            }
          },
          "F": {
            "weights": {
              "hat":       { "basic_headband": 55, "leather_headband": 25, "none": 15, "riverlandskasa_low": 3, "riverlandskasa_wide": 2 },
              "hood":      { "fine_hood": 25, "none": 75 },
              "torso":     { "bandolier1": 70, "none": 30 },
              "hairSide":  { "shoulder_length_drape": 30, "braid-R": 40, "braidcluster-R": 30, "none": 0 },
              "hairSideL": { "braid-L": 90, "none": 10 }
            }
          }
        },
        "clothingColorOverride": {
          "syncAcrossPieces": false,
          "range": {
            "choices": [
              { "weight": 4, "range": { "minH": -30, "maxH": 30, "stops": [
                { "h": -30, "sMin": 0.05, "sMax": 0.30, "vMin": 0.18, "vMax": 0.45 },
                { "h": 30,  "sMin": 0.05, "sMax": 0.30, "vMin": 0.18, "vMax": 0.45 }
              ]}},
              { "weight": 3, "range": { "minH": -90, "maxH": -30, "stops": [
                { "h": -90, "sMin": 0.04, "sMax": 0.25, "vMin": 0.15, "vMax": 0.42 },
                { "h": -30, "sMin": 0.04, "sMax": 0.25, "vMin": 0.15, "vMax": 0.42 }
              ]}},
              { "weight": 2, "range": { "minH": 30, "maxH": 80, "stops": [
                { "h": 30, "sMin": 0.03, "sMax": 0.18, "vMin": 0.20, "vMax": 0.48 },
                { "h": 80, "sMin": 0.03, "sMax": 0.18, "vMin": 0.20, "vMax": 0.48 }
              ]}},
              { "weight": 1, "range": { "minH": -180, "maxH": -90, "stops": [
                { "h": -180, "sMin": 0.03, "sMax": 0.20, "vMin": 0.15, "vMax": 0.40 },
                { "h": -90,  "sMin": 0.03, "sMax": 0.20, "vMin": 0.15, "vMax": 0.40 }
              ]}}
            ]
          }
        }
      }
    },

    "tables": [
      {
        "id": "riverlands-bandit-camp",
        "name": "Riverlands Bandit Camp",
        "tableLocation": "Riverlands Bandit Camp",
        "npcPoolId": "riverlands-bandits",
        "background": {
          "tabletopImageSrc": "./docs/assets/hud/tabletop.png"
        },
        "candlelight": {
          "radiusRefPx": 1200,
          "sources": [{
            "xPct": 0.5,
            "yPct": -0.45,
            "intensity": 0.77,
            "radiusMultiplier": 1.0,
            "flickerSpeed": 4.5,
            "turbulence": 1.2
          }],
          "backlitAlphaDefault": 0.14,
          "thevmenuOpacity": 0.3
        },
        "waterEffect": {
          "enabled": true,
          "grooveCoupling": 0.62,
          "grooveSensitivity": 0.00,
          "highPointFlow": 1.0,
          "highPointSensitivity": 0.55
        },
        "outdoor": {
          "cycleDurationMs": 480000,
          "phases": [
            { "t": 0.00, "name": "predawn",       "skyRgb": [8,   12,  28 ], "skyOpacity": 0.58, "rainIntensity": 0.00 },
            { "t": 0.10, "name": "dawn",          "skyRgb": [200, 100, 50 ], "skyOpacity": 0.15, "rainIntensity": 0.00 },
            { "t": 0.18, "name": "morningburst",  "skyRgb": [210, 220,205 ], "skyOpacity": 0.13, "rainIntensity": 0.80 },
            { "t": 0.30, "name": "clearbreak",    "skyRgb": [255, 225,140 ], "skyOpacity": 0.22, "rainIntensity": 0.05 },
            { "t": 0.40, "name": "midday",        "skyRgb": [255, 218,110 ], "skyOpacity": 0.28, "rainIntensity": 1.00 },
            { "t": 0.58, "name": "afternoonbreak","skyRgb": [255, 222,135 ], "skyOpacity": 0.20, "rainIntensity": 0.08 },
            { "t": 0.66, "name": "duskstorm",     "skyRgb": [225, 170,100 ], "skyOpacity": 0.18, "rainIntensity": 0.85 },
            { "t": 0.78, "name": "twilight",      "skyRgb": [70,  30, 110 ], "skyOpacity": 0.42, "rainIntensity": 0.15 },
            { "t": 0.90, "name": "night",         "skyRgb": [5,   12,  25 ], "skyOpacity": 0.60, "rainIntensity": 0.00 }
          ],
          "rain": { "maxDrops": 160, "angleRad": 0.18 },
          "lightning": { "avgIntervalMs": 22000, "onlyPhases": ["morningburst", "midday", "duskstorm"] }
        },
        "bgm": {
          "playlist": [
            "./docs/assets/audio/bgm/tankan_nocturne.mp3"
          ],
          "challenge": "./docs/assets/audio/bgm/challengeloop_placeholder.m4a"
        },
        "bgs": null,
        "speciesWeights": {
          "mao-ao": 1
        }
      },
      {
        "id": "injimis-underclub",
        "name": "Injimi's Underclub",
        "tableLocation": "Injimi's Underclub",
        "npcPoolId": "kumapirran-citizens",
        "unlockRequirement": "rotfang",
        "background": {
          "tabletopImageSrc": "./docs/assets/hud/tabletop.png"
        },
        "candlelight": {
          "radiusRefPx": 1200,
          "sources": [
            { "xPct": 0.0317708333, "yPct": 0.3333333333, "intensity": 0.77, "radiusMultiplier": 1, "flickerSpeed": 4.17, "turbulence": 1 },
            { "xPct": 1.18,         "yPct": 0.3333333333, "intensity": 0.77, "radiusMultiplier": 1, "flickerSpeed": 4.17, "turbulence": 1 }
          ],
          "backlitAlphaDefault": 0.14,
          "thevmenuOpacity": 0.35,
          "backlitBlurDefault": 0
        },
        "bgm": {
          "playlist": [
            "./docs/assets/audio/bgm/tankan_nocturne.mp3"
          ],
          "challenge": "./docs/assets/audio/bgm/challengeloop_placeholder.m4a"
        },
        "bgs": null,
        "speciesWeights": {
          "mao-ao":    1,
          "tletingan": 1,
          "kenkari":   1,
          "rakakoan":  1,
          "engh-sho":  1
        }
      }
    ],
    "activeTableId": "riverlands-bandit-camp"
  }
};

// Future Scratchbones-authored UI modes live under SCRATCHBONES_CONFIG.game.layout.
window.SCRATCHBONES_CONFIG.game.layout.mode = window.SCRATCHBONES_CONFIG.game.layout.mode || 'responsive';
window.SCRATCHBONES_CONFIG.game.layout.authored = window.SCRATCHBONES_CONFIG.game.layout.authored || {};
window.SCRATCHBONES_CONFIG.game.layout.fitter = window.SCRATCHBONES_CONFIG.game.layout.fitter || {};

// Most recent config-boundary cleanup: this file is now the authoritative Scratchbones-only config source.

// Rakako'an use Kenkari bodies with an exclusive upper-face eyepatch selection.
(() => {
  const game = window.SCRATCHBONES_CONFIG.game;
  const appearanceEditor = game.appearanceEditor = game.appearanceEditor || {};
  const species = appearanceEditor.species = appearanceEditor.species || {};
  const rakakoanEyepatches = [
    { id: 'appearance::Rakakoan_M::rakakoan_woven_eyepatch', label: 'Woven Eyepatch' },
    { id: 'appearance::Rakakoan_M::rakakoan_ragged_eyepatch', label: 'Ragged Eyepatch' },
    { id: 'appearance::Rakakoan_M::rakakoan_wrapped_eyepatch', label: 'Wrapped Eyepatch' }
  ];
  const rakakoanEyepatchesFemale = rakakoanEyepatches.map(option => ({
    ...option,
    id: option.id.replace('Rakakoan_M', 'Rakakoan_F')
  }));
  species.rakakoan = {
    label: "Rakako'an",
    parentSpecies: 'kenkari',
    genders: ['male', 'female'],
    swatchBase: '#7dc89a',
    male: {
      defaultCosmetics: { upperFace: 'appearance::Rakakoan_M::rakakoan_woven_eyepatch' },
      slots: [
        { slot: 'upperFace', label: 'Rakako\'an Eyepatch', options: rakakoanEyepatches },
        { slot: 'hairFront', label: 'Front Hair', options: [
          { id: null, label: 'None' },
          { id: 'appearance::Kenkari_M::kenk_forwardtuft_long', label: 'Forward Tuft (Long)' },
          { id: 'appearance::Kenkari_M::kenk_fowardtuft', label: 'Forward Tuft' }
        ]},
        { slot: 'hairBack', label: 'Back Hair', options: [
          { id: null, label: 'None' },
          { id: 'appearance::Kenkari_M::kenk_splayedknot_high_m', label: 'Splayed Knot (High)' },
          { id: 'appearance::Kenkari_M::kenk_splayedknot_low_m', label: 'Splayed Knot (Low)' }
        ]},
        { slot: 'hairSide', label: 'Side Hair (R)', options: [
          { id: null, label: 'None' },
          { id: 'appearance::Kenkari_M::kenk_braid-R_m', label: 'Braid (Right)' },
          { id: 'appearance::Kenkari_M::kenk_braidcluster-R_m', label: 'Braid Cluster (Right)' }
        ]},
        { slot: 'hairSideL', label: 'Side Hair (L)', options: [
          { id: null, label: 'None' },
          { id: 'appearance::Kenkari_M::kenk_braid-L_m', label: 'Braid (Left)' }
        ]},
        { slot: 'facialHair', label: 'Facial Hair', options: [
          { id: null, label: 'None' },
          { id: 'appearance::Kenkari_M::kenk_wildbeard', label: 'Wild Beard' }
        ]}
      ],
      colorOptions: [
        { label: 'Jade', h: -20, s: 0.80, v: 0.00 },
        { label: 'Lime', h: -80, s: 0.90, v: 0.00 },
        { label: 'Teal', h: 40, s: 1.00, v: 0.10 },
        { label: 'Amethyst', h: 120, s: 0.90, v: 0.00 },
        { label: 'Fuchsia', h: 160, s: 0.80, v: -0.10 },
        { label: 'Ember', h: -120, s: 0.80, v: -0.10 },
        { label: 'Chartreuse', h: -40, s: 0.70, v: 0.10 },
        { label: 'Azure', h: 60, s: 0.90, v: 0.10 },
        { label: 'Red', h: -143, s: 1.00, v: 0.00 },
        { label: 'Orange', h: -113, s: 1.00, v: 0.10 },
        { label: 'Yellow', h: -83, s: 1.20, v: 0.25 },
        { label: 'Green', h: -23, s: 1.00, v: 0.05 },
        { label: 'Blue', h: 77, s: 1.00, v: 0.00 },
        { label: 'Brown', h: -113, s: 0.10, v: -0.38 }
      ]
    },
    female: {
      defaultCosmetics: { upperFace: 'appearance::Rakakoan_F::rakakoan_woven_eyepatch' },
      slots: [
        { slot: 'upperFace', label: 'Rakako\'an Eyepatch', options: rakakoanEyepatchesFemale },
        { slot: 'hairBack', label: 'Back Hair', options: [
          { id: null, label: 'None' },
          { id: 'appearance::Kenkari_F::kenk_longponytail_f', label: 'Long Ponytail' },
          { id: 'appearance::Kenkari_F::kenk_splayedknot_high_f', label: 'Splayed Knot (High)' },
          { id: 'appearance::Kenkari_F::kenk_splayedknot_low_f', label: 'Splayed Knot (Low)' }
        ]},
        { slot: 'hairSide', label: 'Side Hair (R)', options: [
          { id: null, label: 'None' },
          { id: 'appearance::Kenkari_F::kenk_braid-R_f', label: 'Braid (Right)' },
          { id: 'appearance::Kenkari_F::kenk_braidcluster-R_f', label: 'Braid Cluster (Right)' }
        ]},
        { slot: 'hairSideL', label: 'Side Hair (L)', options: [
          { id: null, label: 'None' },
          { id: 'appearance::Kenkari_F::kenk_braid-L_f', label: 'Braid (Left)' }
        ]}
      ],
      colorOptions: [
        { label: 'Ember', h: -115, s: 0.20, v: 0.05 },
        { label: 'Copper', h: -105, s: 0.25, v: 0.10 },
        { label: 'Gold', h: -92, s: 0.40, v: 0.15 },
        { label: 'Honey', h: -80, s: 0.45, v: 0.20 },
        { label: 'Yellow', h: -75, s: 0.50, v: 0.20 },
        { label: 'Saffron', h: -65, s: 0.52, v: 0.15 },
        { label: 'Chartreuse', h: -53, s: 0.58, v: 0.05 },
        { label: 'Lime', h: -42, s: 0.62, v: 0.00 },
        { label: 'Spring', h: -32, s: 0.68, v: 0.05 },
        { label: 'Umber', h: -100, s: -0.30, v: -0.40 },
        { label: 'Ochre', h: -80, s: -0.20, v: -0.25 },
        { label: 'Straw', h: -65, s: -0.10, v: -0.15 }
      ]
    }
  };
  game.portrait = game.portrait || {};
  game.portrait.cosmetics = game.portrait.cosmetics || {};
  game.portrait.cosmetics.defaultTintColors = {
    ...(game.portrait.cosmetics.defaultTintColors || {}),
    rakakoan_woven_eyepatch: { UPPER_FACE: { h: -106, s: -0.25, v: -0.62 } },
    rakakoan_ragged_eyepatch: { UPPER_FACE: { h: -170.5, s: -1, v: -0.308 } },
    rakakoan_wrapped_eyepatch: { UPPER_FACE: { h: -178, s: -1, v: 0.221 } }
  };
  game.collections = game.collections || {};
  game.collections.appearanceSlots = [
    ...(game.collections.appearanceSlots || []),
    {
      key: 'upperFace',
      slot: 'upperFace',
      label: 'Upper Face',
      species: ['rakakoan'],
      tintKeys: ['UPPER_FACE'],
      dyeGroup: 'cloth'
    }
  ];
})();
(function applyScratchbonesCssConfig(root) {
  const clampToCss = (clamp) => {
    const minPx = Number(clamp?.minPx);
    const vmin = Number(clamp?.vmin);
    const maxPx = Number(clamp?.maxPx);
    if (![minPx, vmin, maxPx].every(Number.isFinite)) return '';
    return `clamp(${minPx}px, ${vmin}vmin, ${maxPx}px)`;
  };

  const controls = root.SCRATCHBONES_CONFIG?.game?.mobileControls || {};
  const rootStyle = root.document?.documentElement?.style;
  if (!rootStyle) return;

  for (const key of ['actionArch', 'outerArch']) {
    const entry = controls[key];
    const cssVar = entry?.cssVar;
    const radiusCss = clampToCss(entry?.radiusClamp);
    if (cssVar && radiusCss) rootStyle.setProperty(cssVar, radiusCss);
  }
})(window);
