// Authored Foundry head/shaft mounting lines and explicit per-pair layering. No runtime type-based layer inference.
window.MODULAR_WEAPON_CONFIG = {
  "schema": "hobunji_modular_weapons.v2",
  "upgrade": {
    "id": "foundry",
    "label": "Foundry",
    "townValue": 3,
    "cost": {
      "gold": 2000,
      "stone": 200,
      "wood": 100,
      "bar_tinBronze": 30
    }
  },
  "craftCost": {
    "gold": 40,
    "bars": 5,
    "wood": 5
  },
  "heads": {
    "dagger-sword": {
      "label": "Dagger Sword",
      "sourceShape": "daggerSword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_dagger-sword.png",
      "dmgType": "sharp",
      "mount": {
        "type": "blade",
        "start": {
          "x": 188,
          "y": 558
        },
        "end": {
          "x": 188,
          "y": 478
        }
      }
    },
    "dagger": {
      "label": "Dagger",
      "sourceShape": "dagger",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_dagger.png",
      "dmgType": "sharp",
      "mount": {
        "type": "blade",
        "start": {
          "x": 207,
          "y": 623
        },
        "end": {
          "x": 207,
          "y": 543
        }
      }
    },
    "fishing-mace": {
      "label": "Fishing Mace",
      "sourceShape": "fishingmace",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_fishing_mace.png",
      "dmgType": "blunt",
      "mount": {
        "type": "weight",
        "start": {
          "x": 185,
          "y": 974
        },
        "end": {
          "x": 185,
          "y": 894
        }
      }
    },
    "fishing-spear": {
      "label": "Fishing Spear",
      "sourceShape": "fishingspear",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_fishing_spear.png",
      "dmgType": "sharp",
      "mount": {
        "type": "blade",
        "start": {
          "x": 214,
          "y": 901
        },
        "end": {
          "x": 214,
          "y": 821
        }
      }
    },
    "harlyao-broadsword": {
      "label": "Harlyao Broadsword",
      "sourceShape": "harlyaoBroadsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_harlyao_broadsword.png",
      "dmgType": "sharp",
      "mount": {
        "type": "blade",
        "start": {
          "x": 200,
          "y": 664
        },
        "end": {
          "x": 200,
          "y": 584
        }
      }
    },
    "harlyao-longsword": {
      "label": "Harlyao Longsword",
      "sourceShape": "harlyaoLongsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_harlyao_longsword.png",
      "dmgType": "sharp",
      "mount": {
        "type": "blade",
        "start": {
          "x": 196,
          "y": 709
        },
        "end": {
          "x": 196,
          "y": 629
        }
      }
    },
    "hatchet": {
      "label": "Hatchet",
      "sourceShape": "hatchet",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_hatchet.png",
      "dmgType": "sharp",
      "mount": {
        "type": "weight",
        "start": {
          "x": 206,
          "y": 1004
        },
        "end": {
          "x": 206,
          "y": 924
        }
      }
    },
    "hoe": {
      "label": "Hoe",
      "sourceShape": "hoe",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_hoe.png",
      "dmgType": "sharp",
      "mount": {
        "type": "weight",
        "start": {
          "x": 187,
          "y": 1170
        },
        "end": {
          "x": 187,
          "y": 1090
        }
      },
      "mountNote": "Eye mount: transverse hoe blade attaches through a sleeve."
    },
    "kylie": {
      "label": "Kylie",
      "sourceShape": "kylie",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_kylie.png",
      "dmgType": "blunt",
      "mount": {
        "type": "weight",
        "start": {
          "x": 203,
          "y": 736
        },
        "end": {
          "x": 203,
          "y": 656
        }
      }
    },
    "pick-shovel-pick": {
      "label": "Pick Shovel Pick",
      "sourceShape": "pickshovel",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_pick-shovel_pick.png",
      "dmgType": "sharp",
      "mount": {
        "type": "weight",
        "start": {
          "x": 207,
          "y": 319
        },
        "end": {
          "x": 207,
          "y": 239
        }
      },
      "mountNote": "Straight original eye line (not a rotated tang); the Pick-Shovel haft now has an additional centered, perpendicular tang at this location."
    },
    "pickshovel-scoop": {
      "label": "Pickshovel Scoop",
      "sourceShape": "pickshovel",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_pickshovel_scoop.png",
      "dmgType": "blunt",
      "mount": {
        "type": "blade",
        "start": {
          "x": 195,
          "y": 856
        },
        "end": {
          "x": 195,
          "y": 776
        }
      },
      "mountNote": "Tang mount: shovel bowl must remain clear of the haft."
    },
    "plains-blade": {
      "label": "Plains Blade",
      "sourceShape": "plainsSword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_plains-blade.png",
      "dmgType": "sharp",
      "mount": {
        "type": "blade",
        "start": {
          "x": 187,
          "y": 408
        },
        "end": {
          "x": 187,
          "y": 328
        }
      }
    },
    "porakaneki-greatclub": {
      "label": "Porakaneki Greatclub",
      "sourceShape": "porakanekiGreatclub",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_porakaneki_greatclub.png",
      "dmgType": "sharp",
      "mount": {
        "type": "weight",
        "start": {
          "x": 189,
          "y": 809
        },
        "end": {
          "x": 189,
          "y": 729
        }
      }
    },
    "war-cleaver": {
      "label": "War Cleaver",
      "sourceShape": "warCleaver",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_war-cleaver.png",
      "dmgType": "sharp",
      "mount": {
        "type": "blade",
        "start": {
          "x": 239,
          "y": 858
        },
        "end": {
          "x": 239,
          "y": 778
        }
      }
    },
    "warhammer": {
      "label": "Warhammer",
      "sourceShape": "warhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_warhammer.png",
      "dmgType": "blunt",
      "mount": {
        "type": "weight",
        "start": {
          "x": 208,
          "y": 931
        },
        "end": {
          "x": 208,
          "y": 851
        }
      }
    },
    "work-hammer": {
      "label": "Work Hammer",
      "sourceShape": "workhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_work_hammer.png",
      "dmgType": "blunt",
      "mount": {
        "type": "weight",
        "start": {
          "x": 209,
          "y": 912
        },
        "end": {
          "x": 209,
          "y": 832
        }
      }
    },
    "bshuakauitl": {
      "label": "B'shuakauitl",
      "sourceShape": "bshuakauitl",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_bshuakauitl.png",
      "dmgType": "blunt",
      "editorOnly": true,
      "mount": {
        "type": "weight",
        "start": {
          "x": 189,
          "y": 1003
        },
        "end": {
          "x": 189,
          "y": 923
        }
      }
    }
  },
  "shafts": {
    "bshuakauitl": {
      "label": "B'Shuakauitl",
      "sourceShape": "bshuakauitl",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_b'shuakauitl.png",
      "overrides": {
        "dagger-sword": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "dagger": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "scaleX": 0.6,
          "scaleY": 0.9,
          "x": -5,
          "y": 30,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleX": 0.5,
          "scaleY": 0.309,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "scaleX": 0.8,
          "scaleY": 0.45,
          "x": 5,
          "y": -20,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "scaleX": 0.85,
          "y": -45,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "scaleX": 0.55,
          "scaleY": 1.9,
          "x": 7,
          "y": 15,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "scaleX": 0.435,
          "scaleY": 2.2,
          "y": -35,
          "rotation": 1,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "disallow": true,
          "layerOrder": "head-over-haft"
        }
      },
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 189,
            "y": 1003
          },
          "end": {
            "x": 189,
            "y": 923
          }
        },
        {
          "type": "eye",
          "start": {
            "x": 198,
            "y": 229
          },
          "end": {
            "x": 198,
            "y": 309
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 169,
            "y": 963
          },
          "end": {
            "x": 209,
            "y": 963
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 218,
            "y": 269
          },
          "end": {
            "x": 178,
            "y": 269
          }
        }
      ],
      "maxAttachments": 8
    },
    "dagger-sword": {
      "label": "Dagger Sword",
      "sourceShape": "daggerSword",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_dagger-sword.png",
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.464,
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "dagger": {
          "scaleY": 0.625,
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "scaleX": 0.85,
          "scaleY": 1.7,
          "y": -10,
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "scaleX": 1.25,
          "scaleY": 1.05,
          "y": -15,
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "scaleX": 1.1,
          "scaleY": 1.15,
          "y": 15,
          "rotation": 1,
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "scaleY": 0.866,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "scaleX": 0.9,
          "scaleY": 1.5,
          "flipY": true,
          "x": 5,
          "y": -15,
          "rotation": 3,
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "scaleX": 0.5,
          "scaleY": 2,
          "y": -30,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleY": 0.7,
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "scaleY": 0.523,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "x": 20,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "layerOrder": "head-over-haft"
        }
      },
      "maxAttachments": 8,
      "mounts": [
        {
          "type": "tang",
          "start": {
            "x": 193,
            "y": 648
          },
          "end": {
            "x": 193,
            "y": 728
          }
        }
      ]
    },
    "dagger": {
      "label": "Dagger",
      "sourceShape": "dagger",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_dagger.png",
      "overrides": {
        "dagger-sword": {
          "x": -5,
          "y": 30,
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "dagger": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "scaleX": 0.9,
          "scaleY": 1.25,
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "scaleY": 0.75,
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "scaleX": 1.2,
          "scaleY": 0.7,
          "x": -3,
          "y": 30,
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 30,
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "scaleX": 1.1,
          "scaleY": 1.2,
          "flipY": true,
          "x": 7,
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "scaleX": 0.65,
          "scaleY": 1.3,
          "y": -2,
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleX": 0.9,
          "scaleY": 0.55,
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "scaleX": 0.9,
          "scaleY": 0.947,
          "y": 45,
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "scaleX": 1.17,
          "scaleY": 1.8,
          "x": 30,
          "y": 35,
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        }
      },
      "mounts": [
        {
          "type": "tang",
          "start": {
            "x": 211.5,
            "y": 617
          },
          "end": {
            "x": 211.5,
            "y": 537
          }
        }
      ],
      "maxAttachments": 8
    },
    "fishing-mace": {
      "label": "Fishing Mace",
      "sourceShape": "fishingmace",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_fishing_mace.png",
      "overrides": {
        "dagger-sword": {
          "x": 5,
          "y": 30,
          "layerOrder": "haft-over-head"
        },
        "dagger": {
          "scaleX": 0.7,
          "scaleY": 0.6,
          "x": 35,
          "y": -15,
          "rotation": -90,
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "x": 5,
          "y": 30,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "scaleX": 1.25,
          "x": 5,
          "y": 30,
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "scaleX": 1.05,
          "scaleY": 0.5,
          "x": 35,
          "y": -40,
          "rotation": -90,
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "scaleX": 1.05,
          "scaleY": 0.5,
          "x": 40,
          "y": -35,
          "rotation": -90,
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "x": 5,
          "y": 30,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "x": 5,
          "y": 30,
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "x": 5,
          "y": 30,
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "flipX": true,
          "flipY": true,
          "x": 35,
          "y": -25,
          "rotation": -90,
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "x": 5,
          "y": 30,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleX": 1.1,
          "scaleY": 0.35,
          "x": -65,
          "y": -30,
          "rotation": -90,
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "scaleY": 0.85,
          "x": 5,
          "y": 115,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "x": 5,
          "y": 30,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "x": 5,
          "y": 30,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "x": 5,
          "y": 30,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "x": 5,
          "y": 30,
          "layerOrder": "head-over-haft"
        }
      },
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 193,
            "y": 850
          },
          "end": {
            "x": 193,
            "y": 770
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 173,
            "y": 810
          },
          "end": {
            "x": 213,
            "y": 810
          }
        }
      ],
      "maxAttachments": 8
    },
    "fishing-spear": {
      "label": "Fishing Spear",
      "sourceShape": "fishingspear",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_fishing_spear.png",
      "overrides": {
        "dagger-sword": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "dagger": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "scaleX": 0.95,
          "scaleY": 1.55,
          "y": 170,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "scaleX": 1.1,
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "scaleX": 0.85,
          "scaleY": 0.85,
          "y": 25,
          "disallow": false,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "x": 1,
          "y": 50,
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "scaleY": 1.2,
          "flipY": true,
          "x": 10,
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "scaleX": 0.8,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleY": 0.5,
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "scaleX": 0.9,
          "scaleY": 0.75,
          "x": 3,
          "y": 220,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "disallow": false,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "scaleX": 0.82,
          "scaleY": 1.35,
          "y": 7,
          "rotation": 1,
          "disallow": false,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "scaleX": 0.8,
          "scaleY": 1.1,
          "y": -5,
          "disallow": false,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        }
      },
      "mounts": [
        {
          "type": "tang",
          "start": {
            "x": 199,
            "y": 834
          },
          "end": {
            "x": 199,
            "y": 754
          }
        }
      ],
      "maxAttachments": 8
    },
    "harlyao-broadsword": {
      "label": "Harlyao Broadsword",
      "sourceShape": "harlyaoBroadsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_harlyao_broadsword.png",
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.787,
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "scaleX": 0.9,
          "scaleY": 1.5,
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "scaleX": 0.75,
          "scaleY": 1.5,
          "x": -5,
          "y": 40,
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "scaleY": 2,
          "flipY": true,
          "x": 5,
          "y": 10,
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleY": 0.65,
          "x": -3,
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "scaleX": 1.15,
          "scaleY": 0.875,
          "x": -5,
          "y": 270,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "scaleY": 2,
          "x": 30,
          "y": 45,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "dagger": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head"
        }
      },
      "mounts": [
        {
          "type": "tang",
          "start": {
            "x": 200.5,
            "y": 655
          },
          "end": {
            "x": 200.5,
            "y": 575
          }
        }
      ],
      "maxAttachments": 8
    },
    "harlyao-longsword": {
      "label": "Harlyao Longsword",
      "sourceShape": "harlyaoLongsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_harlyao_longsword.png",
      "overrides": {
        "dagger-sword": {
          "scaleX": 0.9,
          "scaleY": 0.8657,
          "layerOrder": "haft-over-head"
        },
        "dagger": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "scaleX": 0.9,
          "scaleY": 2,
          "y": 10,
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "scaleX": 0.8,
          "scaleY": 1.6,
          "x": -7,
          "y": 55,
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "scaleX": 0.9,
          "scaleY": 2.2,
          "flipY": true,
          "y": 20,
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleX": 0.9,
          "scaleY": 0.75,
          "x": -6,
          "y": 20,
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "scaleX": 0.8,
          "x": -7,
          "y": 330,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "scaleY": 2.5,
          "x": 20,
          "y": 70,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "layerOrder": "head-over-haft"
        }
      },
      "mounts": [
        {
          "type": "tang",
          "start": {
            "x": 200.5,
            "y": 655
          },
          "end": {
            "x": 200.5,
            "y": 575
          }
        }
      ],
      "maxAttachments": 8
    },
    "war-cleaver": {
      "label": "War Cleaver",
      "sourceShape": "warCleaver",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_war-cleaver.png",
      "overrides": {
        "dagger-sword": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "dagger": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "scaleY": 1.2,
          "x": 15,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleY": 0.456,
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        }
      },
      "mounts": [
        {
          "type": "tang",
          "start": {
            "x": 205,
            "y": 835
          },
          "end": {
            "x": 205,
            "y": 755
          }
        }
      ],
      "maxAttachments": 8
    },
    "warhammer": {
      "label": "Warhammer",
      "sourceShape": "warhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_warhammer.png",
      "overrides": {
        "dagger-sword": {
          "x": 12,
          "y": 5,
          "layerOrder": "haft-over-head"
        },
        "dagger": {
          "scaleX": 0.9,
          "scaleY": 0.75,
          "x": 40,
          "y": -90,
          "rotation": -90,
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "scaleX": 1.1,
          "scaleY": 1.2,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "scaleY": 1.2,
          "flipX": true,
          "x": -40,
          "y": -90,
          "rotation": -90,
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "scaleX": 1.35,
          "scaleY": 0.8,
          "x": 25,
          "y": -100,
          "rotation": -90,
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "scaleX": 1.65,
          "x": 5,
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "scaleX": 1.2,
          "scaleY": 0.9,
          "x": 20,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "scaleY": 1.83,
          "x": 5,
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "scaleX": 1.65,
          "x": 5,
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "scaleX": 1.05,
          "scaleY": 1.05,
          "flipX": true,
          "flipY": true,
          "x": 40,
          "y": -75,
          "rotation": -90,
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "x": 5,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleX": 1.2,
          "scaleY": 0.75,
          "x": 5,
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "scaleX": 1.5,
          "x": 10,
          "y": 300,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "scaleX": 1.3,
          "x": 5,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "scaleX": 1.65,
          "x": 5,
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "x": 5,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "scaleX": 1.65,
          "x": 5,
          "layerOrder": "head-over-haft"
        }
      },
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 206,
            "y": 996
          },
          "end": {
            "x": 206,
            "y": 916
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 186,
            "y": 956
          },
          "end": {
            "x": 226,
            "y": 956
          }
        }
      ],
      "maxAttachments": 8
    },
    "bgungku": {
      "label": "B'gungku (donor not yet mapped)",
      "sourceShape": "bgungku",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_bgungku.png",
      "overrides": {
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "dagger": {
          "layerOrder": "haft-over-head"
        },
        "dagger-sword": {
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "layerOrder": "head-over-haft"
        }
      },
      "editorOnly": true,
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 225,
            "y": 602
          },
          "end": {
            "x": 225,
            "y": 522
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 205,
            "y": 562
          },
          "end": {
            "x": 245,
            "y": 562
          }
        }
      ],
      "maxAttachments": 8
    },
    "hatchet": {
      "label": "Hatchet",
      "sourceShape": "hatchet",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_hatchet.png",
      "overrides": {
        "hatchet": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "dagger": {
          "layerOrder": "haft-over-head"
        },
        "dagger-sword": {
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head"
        },
        "hoe": {
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "layerOrder": "head-over-haft"
        }
      },
      "editorOnly": true,
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 206,
            "y": 1004
          },
          "end": {
            "x": 206,
            "y": 924
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 186,
            "y": 964
          },
          "end": {
            "x": 226,
            "y": 964
          }
        }
      ],
      "maxAttachments": 8
    },
    "hoe": {
      "label": "Hoe",
      "sourceShape": "hoe",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_hoe.png",
      "overrides": {
        "hoe": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "dagger": {
          "layerOrder": "haft-over-head"
        },
        "dagger-sword": {
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "layerOrder": "head-over-haft"
        }
      },
      "editorOnly": true,
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 187,
            "y": 1170
          },
          "end": {
            "x": 187,
            "y": 1090
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 167,
            "y": 1130
          },
          "end": {
            "x": 207,
            "y": 1130
          }
        }
      ],
      "maxAttachments": 8
    },
    "kylie": {
      "label": "Kylie",
      "sourceShape": "kylie",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_kylie.png",
      "overrides": {
        "kylie": {
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "dagger": {
          "layerOrder": "haft-over-head"
        },
        "dagger-sword": {
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "layerOrder": "head-over-haft"
        }
      },
      "editorOnly": true,
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 203,
            "y": 736
          },
          "end": {
            "x": 203,
            "y": 656
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 183,
            "y": 696
          },
          "end": {
            "x": 223,
            "y": 696
          }
        }
      ],
      "maxAttachments": 8
    },
    "pick-shovel": {
      "label": "Pick-Shovel",
      "sourceShape": "pickshovel",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_pick-shovel.png",
      "overrides": {
        "dagger-sword": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "dagger": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "animation": "thrust",
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "animation": "thrust",
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "animation": "thrust",
          "layerOrder": "head-over-haft"
        }
      },
      "editorOnly": true,
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 207,
            "y": 319
          },
          "end": {
            "x": 207,
            "y": 239
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 195,
            "y": 856
          },
          "end": {
            "x": 195,
            "y": 776
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 187,
            "y": 279
          },
          "end": {
            "x": 227,
            "y": 279
          }
        }
      ],
      "maxAttachments": 8,
      "mountNotes": "Pick end uses an eye, scoop end uses a tang. Both original matching pairs remain explicitly disallowed for re-forging."
    },
    "plains-sword": {
      "label": "Plains Sword",
      "sourceShape": "plainsSword",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_plains_sword.png",
      "overrides": {
        "plains-blade": {
          "disallow": true,
          "layerOrder": "haft-over-head"
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "dagger": {
          "layerOrder": "haft-over-head"
        },
        "dagger-sword": {
          "layerOrder": "haft-over-head"
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head"
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head"
        },
        "hatchet": {
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft"
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head"
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "layerOrder": "head-over-haft"
        }
      },
      "editorOnly": true,
      "mounts": [
        {
          "type": "tang",
          "start": {
            "x": 187,
            "y": 408
          },
          "end": {
            "x": 187,
            "y": 328
          }
        }
      ],
      "maxAttachments": 8
    }
  }
};
