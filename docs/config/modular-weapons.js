// Foundry sprite attachment configuration.
window.MODULAR_WEAPON_CONFIG = {
  "schema": "hobunji_modular_weapons.v1",
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
      "attach": {
        "x": 188,
        "y": 558
      },
      "dmgType": "sharp"
    },
    "dagger": {
      "label": "Dagger",
      "sourceShape": "dagger",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_dagger.png",
      "attach": {
        "x": 207,
        "y": 623
      },
      "dmgType": "sharp"
    },
    "fishing-mace": {
      "label": "Fishing Mace",
      "sourceShape": "fishingmace",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_fishing_mace.png",
      "attach": {
        "x": 185,
        "y": 974
      },
      "dmgType": "blunt"
    },
    "fishing-spear": {
      "label": "Fishing Spear",
      "sourceShape": "fishingspear",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_fishing_spear.png",
      "attach": {
        "x": 214,
        "y": 901
      },
      "dmgType": "sharp"
    },
    "harlyao-broadsword": {
      "label": "Harlyao Broadsword",
      "sourceShape": "harlyaoBroadsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_harlyao_broadsword.png",
      "attach": {
        "x": 200,
        "y": 664
      },
      "dmgType": "sharp"
    },
    "harlyao-longsword": {
      "label": "Harlyao Longsword",
      "sourceShape": "harlyaoLongsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_harlyao_longsword.png",
      "attach": {
        "x": 196,
        "y": 709
      },
      "dmgType": "sharp"
    },
    "hatchet": {
      "label": "Hatchet",
      "sourceShape": "hatchet",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_hatchet.png",
      "attach": {
        "x": 206,
        "y": 1004
      },
      "dmgType": "sharp"
    },
    "hoe": {
      "label": "Hoe",
      "sourceShape": "hoe",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_hoe.png",
      "attach": {
        "x": 187,
        "y": 1170
      },
      "dmgType": "sharp"
    },
    "kylie": {
      "label": "Kylie",
      "sourceShape": "kylie",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_kylie.png",
      "attach": {
        "x": 203,
        "y": 736
      },
      "dmgType": "blunt"
    },
    "pick-shovel-pick": {
      "label": "Pick Shovel Pick",
      "sourceShape": "pickshovel",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_pick-shovel_pick.png",
      "attach": {
        "x": 207,
        "y": 319
      },
      "dmgType": "sharp"
    },
    "pickshovel-scoop": {
      "label": "Pickshovel Scoop",
      "sourceShape": "pickshovel",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_pickshovel_scoop.png",
      "attach": {
        "x": 195,
        "y": 856
      },
      "dmgType": "blunt"
    },
    "plains-blade": {
      "label": "Plains Blade",
      "sourceShape": "plainsSword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_plains-blade.png",
      "attach": {
        "x": 187,
        "y": 408
      },
      "dmgType": "sharp"
    },
    "porakaneki-greatclub": {
      "label": "Porakaneki Greatclub",
      "sourceShape": "porakanekiGreatclub",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_porakaneki_greatclub.png",
      "attach": {
        "x": 189,
        "y": 809
      },
      "dmgType": "sharp"
    },
    "war-cleaver": {
      "label": "War Cleaver",
      "sourceShape": "warCleaver",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_war-cleaver.png",
      "attach": {
        "x": 239,
        "y": 858
      },
      "dmgType": "sharp"
    },
    "warhammer": {
      "label": "Warhammer",
      "sourceShape": "warhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_warhammer.png",
      "attach": {
        "x": 208,
        "y": 931
      },
      "dmgType": "blunt"
    },
    "work-hammer": {
      "label": "Work Hammer",
      "sourceShape": "workhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_work_hammer.png",
      "attach": {
        "x": 209,
        "y": 912
      },
      "dmgType": "blunt"
    }
  },
  "shafts": {
    "bshuakauitl": {
      "label": "B'Shuakauitl",
      "sourceShape": "bshuakauitl",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_b'shuakauitl.png",
      "attachments": [
        {
          "x": 189,
          "y": 1003,
          "rotation": 0
        },
        {
          "x": 198,
          "y": 229,
          "rotation": 180
        }
      ],
      "defaults": {
        "scaleX": 0.5,
        "scaleY": 0.9,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0,
        "animation": "sweep"
      },
      "overrides": {
        "plains-blade": {
          "scaleY": 0.309,
          "disallow": true
        },
        "warhammer": {
          "scaleX": 0.55,
          "scaleY": 1.9,
          "x": 7,
          "y": 15
        },
        "pickshovel-scoop": {
          "disallow": true
        },
        "work-hammer": {
          "scaleX": 0.435,
          "scaleY": 2.2,
          "y": -35,
          "rotation": 1
        },
        "war-cleaver": {
          "scaleX": 0.85,
          "scaleY": 1,
          "y": -45
        },
        "hatchet": {
          "scaleX": 0.6,
          "scaleY": 0.9,
          "x": -5,
          "y": 30
        },
        "porakaneki-greatclub": {
          "scaleX": 0.8,
          "scaleY": 0.45,
          "x": 5,
          "y": -20,
          "rotation": 0
        },
        "dagger": {
          "disallow": true
        },
        "dagger-sword": {
          "disallow": true
        },
        "harlyao-broadsword": {
          "disallow": true
        },
        "harlyao-longsword": {
          "disallow": true
        },
        "pick-shovel-pick": {
          "disallow": true
        },
        "kylie": {
          "disallow": true
        },
        "hoe": {
          "disallow": true
        },
        "fishing-spear": {
          "disallow": true
        }
      }
    },
    "dagger-sword": {
      "label": "Dagger Sword",
      "sourceShape": "daggerSword",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_dagger-sword.png",
      "attachments": [
        {
          "x": 193,
          "y": 648,
          "rotation": 180
        }
      ],
      "defaults": {
        "scaleX": 1,
        "scaleY": 1,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0,
        "animation": "sweep"
      },
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.464,
          "animation": "thrust",
          "disallow": true
        },
        "dagger": {
          "scaleY": 0.625,
          "animation": "thrust"
        },
        "fishing-spear": {
          "scaleX": 0.85,
          "scaleY": 1.7,
          "y": -10
        },
        "harlyao-broadsword": {
          "scaleX": 1.25,
          "scaleY": 1.05,
          "y": -15
        },
        "harlyao-longsword": {
          "scaleX": 1.1,
          "scaleY": 1.15,
          "y": 15,
          "rotation": 1
        },
        "hatchet": {
          "scaleY": 0.866,
          "disallow": true
        },
        "pickshovel-scoop": {
          "scaleX": 0.5,
          "scaleY": 2,
          "y": -30
        },
        "plains-blade": {
          "scaleY": 0.7
        },
        "porakaneki-greatclub": {
          "scaleY": 0.523,
          "disallow": true
        },
        "war-cleaver": {
          "scaleX": 1,
          "scaleY": 1,
          "x": 20
        },
        "fishing-mace": {
          "disallow": true
        },
        "pick-shovel-pick": {
          "scaleX": 0.9,
          "scaleY": 1.5,
          "flipY": true,
          "x": 5,
          "y": -15,
          "rotation": 3
        },
        "warhammer": {
          "disallow": true
        },
        "hoe": {
          "disallow": true
        },
        "work-hammer": {
          "disallow": true
        }
      },
      "maxAttachments": 1
    },
    "dagger": {
      "label": "Dagger",
      "sourceShape": "dagger",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_dagger.png",
      "attachments": [
        {
          "x": 211.5,
          "y": 617,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 0.9,
        "scaleY": 1.1,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 45,
        "rotation": 0,
        "animation": "thrust"
      },
      "overrides": {
        "dagger-sword": {
          "scaleX": 1,
          "scaleY": 1,
          "x": -5,
          "y": 30
        },
        "plains-blade": {
          "scaleY": 0.55,
          "y": 0,
          "animation": "sweep"
        },
        "porakaneki-greatclub": {
          "scaleY": 0.947,
          "disallow": true
        },
        "pick-shovel-pick": {
          "scaleX": 1.1,
          "scaleY": 1.2,
          "flipY": true,
          "x": 7,
          "y": 0
        },
        "harlyao-broadsword": {
          "scaleX": 1,
          "scaleY": 0.75,
          "y": 0
        },
        "harlyao-longsword": {
          "scaleX": 1.2,
          "scaleY": 0.7,
          "x": -3,
          "y": 30
        },
        "kylie": {
          "y": 30
        },
        "pickshovel-scoop": {
          "scaleX": 0.65,
          "scaleY": 1.3,
          "y": -2
        },
        "war-cleaver": {
          "scaleX": 1.17,
          "scaleY": 1.8,
          "x": 30,
          "y": 35,
          "disallow": true
        },
        "hatchet": {
          "disallow": true
        },
        "warhammer": {
          "disallow": true
        },
        "work-hammer": {
          "disallow": true
        },
        "fishing-mace": {
          "disallow": true
        },
        "hoe": {
          "disallow": true
        },
        "fishing-spear": {
          "scaleY": 1.25,
          "y": 0
        },
        "dagger": {
          "disallow": true
        }
      }
    },
    "fishing-mace": {
      "label": "Fishing Mace",
      "sourceShape": "fishingmace",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_fishing_mace.png",
      "attachments": [
        {
          "x": 193,
          "y": 850,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 1,
        "scaleY": 1,
        "flipX": false,
        "flipY": false,
        "x": 5,
        "y": 30,
        "rotation": 0,
        "animation": "sweep"
      },
      "overrides": {
        "hatchet": {},
        "dagger": {
          "scaleX": 0.7,
          "scaleY": 0.6,
          "x": 35,
          "y": -15,
          "rotation": -90
        },
        "fishing-spear": {
          "scaleX": 1.25
        },
        "harlyao-broadsword": {
          "scaleX": 1.05,
          "scaleY": 0.5,
          "x": 35,
          "y": -40,
          "rotation": -90
        },
        "harlyao-longsword": {
          "scaleX": 1.05,
          "scaleY": 0.5,
          "x": 40,
          "y": -35,
          "rotation": -90
        },
        "pick-shovel-pick": {
          "flipX": true,
          "flipY": true,
          "x": 35,
          "y": -25,
          "rotation": -90
        },
        "plains-blade": {
          "scaleX": 1.1,
          "scaleY": 0.35,
          "x": -65,
          "y": -30,
          "rotation": -90
        },
        "porakaneki-greatclub": {
          "scaleX": 1,
          "scaleY": 0.85,
          "y": 115
        },
        "work-hammer": {
          "y": 30
        },
        "fishing-mace": {
          "disallow": true
        }
      }
    },
    "fishing-spear": {
      "label": "Fishing Spear",
      "sourceShape": "fishingspear",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_fishing_spear.png",
      "attachments": [
        {
          "x": 199,
          "y": 834,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 1,
        "scaleY": 1,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0,
        "animation": "thrust"
      },
      "overrides": {
        "plains-blade": {
          "scaleY": 0.5
        },
        "harlyao-longsword": {
          "scaleX": 1.1,
          "scaleY": 1
        },
        "hatchet": {
          "scaleX": 0.85,
          "scaleY": 0.85,
          "y": 25,
          "animation": "sweep",
          "disallow": false
        },
        "war-cleaver": {
          "animation": "sweep",
          "disallow": false
        },
        "warhammer": {
          "scaleX": 0.82,
          "scaleY": 1.35,
          "y": 7,
          "rotation": 1,
          "animation": "sweep",
          "disallow": false
        },
        "work-hammer": {
          "scaleX": 0.8,
          "scaleY": 1.1,
          "y": -5,
          "rotation": 0,
          "animation": "sweep",
          "disallow": false
        },
        "porakaneki-greatclub": {
          "scaleX": 0.9,
          "scaleY": 0.75,
          "x": 3,
          "y": 220,
          "animation": "sweep"
        },
        "pick-shovel-pick": {
          "scaleX": 1,
          "scaleY": 1.2,
          "flipY": true,
          "x": 10
        },
        "pickshovel-scoop": {
          "scaleX": 0.8,
          "animation": "sweep"
        },
        "hoe": {
          "animation": "sweep",
          "disallow": true
        },
        "kylie": {
          "scaleX": 1,
          "x": 1,
          "y": 50,
          "animation": "sweep"
        },
        "fishing-mace": {
          "scaleX": 0.95,
          "scaleY": 1.55,
          "x": 0,
          "y": 170,
          "animation": "sweep"
        },
        "fishing-spear": {
          "disallow": true
        }
      }
    },
    "harlyao-broadsword": {
      "label": "Harlyao Broadsword",
      "sourceShape": "harlyaoBroadsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_harlyao_broadsword.png",
      "attachments": [
        {
          "x": 200.5,
          "y": 655,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 1,
        "scaleY": 1,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0,
        "animation": "sweep"
      },
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.787
        },
        "plains-blade": {
          "scaleY": 0.65,
          "x": -3,
          "y": 0
        },
        "porakaneki-greatclub": {
          "scaleX": 1.15,
          "scaleY": 0.875,
          "x": -5,
          "y": 270
        },
        "fishing-spear": {
          "scaleX": 0.9,
          "scaleY": 1.5,
          "y": 0
        },
        "pickshovel-scoop": {
          "disallow": true
        },
        "war-cleaver": {
          "scaleX": 1,
          "scaleY": 2,
          "x": 30,
          "y": 45
        },
        "hatchet": {
          "disallow": true
        },
        "warhammer": {
          "disallow": true
        },
        "pick-shovel-pick": {
          "scaleX": 1,
          "scaleY": 2,
          "flipY": true,
          "x": 5,
          "y": 10
        },
        "hoe": {
          "disallow": true
        },
        "work-hammer": {
          "disallow": true
        },
        "kylie": {
          "scaleX": 0.75,
          "scaleY": 1.5,
          "x": -5,
          "y": 40
        },
        "fishing-mace": {
          "disallow": true
        },
        "harlyao-broadsword": {
          "disallow": true
        }
      }
    },
    "harlyao-longsword": {
      "label": "Harlyao Longsword",
      "sourceShape": "harlyaoLongsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_harlyao_longsword.png",
      "attachments": [
        {
          "x": 200.5,
          "y": 655,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 0.9,
        "scaleY": 1.1,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0,
        "animation": "sweep"
      },
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.8657
        },
        "plains-blade": {
          "scaleY": 0.75,
          "x": -6,
          "y": 20
        },
        "porakaneki-greatclub": {
          "scaleX": 0.8,
          "scaleY": 1,
          "x": -7,
          "y": 330
        },
        "fishing-spear": {
          "scaleY": 2,
          "y": 10
        },
        "fishing-mace": {
          "disallow": true
        },
        "pickshovel-scoop": {
          "disallow": true
        },
        "hoe": {
          "disallow": true
        },
        "warhammer": {
          "disallow": true
        },
        "kylie": {
          "scaleX": 0.8,
          "scaleY": 1.6,
          "x": -7,
          "y": 55
        },
        "war-cleaver": {
          "scaleX": 1,
          "scaleY": 2.5,
          "x": 20,
          "y": 70
        },
        "pick-shovel-pick": {
          "scaleY": 2.2,
          "flipY": true,
          "y": 20
        },
        "work-hammer": {
          "disallow": true
        },
        "hatchet": {
          "disallow": true
        },
        "harlyao-longsword": {
          "disallow": true
        }
      }
    },
    "war-cleaver": {
      "label": "War Cleaver",
      "sourceShape": "warCleaver",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_war-cleaver.png",
      "attachments": [
        {
          "x": 205,
          "y": 835,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 1,
        "scaleY": 1,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0,
        "animation": "sweep"
      },
      "overrides": {
        "plains-blade": {
          "scaleY": 0.456,
          "disallow": true
        },
        "hatchet": {
          "scaleY": 1.2,
          "x": 15
        },
        "harlyao-broadsword": {
          "disallow": true
        },
        "fishing-spear": {
          "disallow": true
        },
        "fishing-mace": {
          "disallow": true
        },
        "dagger": {
          "disallow": true
        },
        "pick-shovel-pick": {
          "disallow": true
        },
        "hoe": {
          "disallow": true
        },
        "harlyao-longsword": {
          "disallow": true
        },
        "pickshovel-scoop": {
          "disallow": true
        },
        "dagger-sword": {
          "disallow": true
        },
        "work-hammer": {
          "disallow": true
        },
        "porakaneki-greatclub": {
          "disallow": true
        },
        "kylie": {
          "disallow": true
        },
        "warhammer": {
          "disallow": true
        },
        "war-cleaver": {
          "disallow": true
        }
      }
    },
    "warhammer": {
      "label": "Warhammer",
      "sourceShape": "warhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_warhammer.png",
      "attachments": [
        {
          "x": 206,
          "y": 996,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 1.65,
        "scaleY": 1,
        "flipX": false,
        "flipY": false,
        "x": 5,
        "y": 0,
        "rotation": 0,
        "animation": "sweep"
      },
      "overrides": {
        "dagger-sword": {
          "scaleX": 1,
          "x": 12,
          "y": 5
        },
        "plains-blade": {
          "scaleX": 1.2,
          "scaleY": 0.75
        },
        "porakaneki-greatclub": {
          "scaleX": 1.5,
          "x": 10,
          "y": 300
        },
        "hatchet": {
          "scaleX": 1.2,
          "scaleY": 0.9,
          "x": 20
        },
        "dagger": {
          "scaleX": 0.9,
          "scaleY": 0.75,
          "x": 40,
          "y": -90,
          "rotation": -90
        },
        "pickshovel-scoop": {
          "scaleX": 1
        },
        "war-cleaver": {
          "scaleX": 1.3
        },
        "work-hammer": {
          "scaleX": 1
        },
        "fishing-mace": {
          "scaleX": 1.1,
          "scaleY": 1.2,
          "x": 0
        },
        "fishing-spear": {
          "scaleX": 1,
          "scaleY": 1.2,
          "flipX": true,
          "x": -40,
          "y": -90,
          "rotation": -90
        },
        "harlyao-broadsword": {
          "scaleX": 1.35,
          "scaleY": 0.8,
          "x": 25,
          "y": -100,
          "rotation": -90
        },
        "hoe": {
          "scaleX": 1,
          "scaleY": 1.83
        },
        "pick-shovel-pick": {
          "scaleX": 1.05,
          "scaleY": 1.05,
          "flipX": true,
          "flipY": true,
          "x": 40,
          "y": -75,
          "rotation": -90
        },
        "warhammer": {
          "disallow": true
        }
      }
    }
  }
};
