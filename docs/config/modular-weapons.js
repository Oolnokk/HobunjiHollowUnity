// Shared foundry costs and sprite attachment authoring. Coordinates use the original 450 × 1204 sprite frame.
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
        "x": 186.0,
        "y": 527
      },
      "dmgType": "sharp"
    },
    "dagger": {
      "label": "Dagger",
      "sourceShape": "dagger",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_dagger.png",
      "attach": {
        "x": 207.0,
        "y": 623
      },
      "dmgType": "sharp"
    },
    "fishing-mace": {
      "label": "Fishing Mace",
      "sourceShape": "fishingmace",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_fishing_mace.png",
      "attach": {
        "x": 196.5,
        "y": 829
      },
      "dmgType": "blunt"
    },
    "fishing-spear": {
      "label": "Fishing Spear",
      "sourceShape": "fishingspear",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_fishing_spear.png",
      "attach": {
        "x": 218.5,
        "y": 836
      },
      "dmgType": "sharp"
    },
    "harlyao-broadsword": {
      "label": "Harlyao Broadsword",
      "sourceShape": "harlyaoBroadsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_harlyao_broadsword.png",
      "attach": {
        "x": 200.0,
        "y": 664
      },
      "dmgType": "sharp"
    },
    "harlyao-longsword": {
      "label": "Harlyao Longsword",
      "sourceShape": "harlyaoLongsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_harlyao_longsword.png",
      "attach": {
        "x": 198.0,
        "y": 678
      },
      "dmgType": "sharp"
    },
    "hatchet": {
      "label": "Hatchet",
      "sourceShape": "hatchet",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_hatchet.png",
      "attach": {
        "x": 262.0,
        "y": 724
      },
      "dmgType": "sharp"
    },
    "hoe": {
      "label": "Hoe",
      "sourceShape": "hoe",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_hoe.png",
      "attach": {
        "x": 271.5,
        "y": 1113
      },
      "dmgType": "sharp"
    },
    "kylie": {
      "label": "Kylie",
      "sourceShape": "kylie",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_kylie.png",
      "attach": {
        "x": 248.0,
        "y": 708
      },
      "dmgType": "sharp"
    },
    "pick-shovel-pick": {
      "label": "Pick Shovel Pick",
      "sourceShape": "pickshovel",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_pick-shovel_pick.png",
      "attach": {
        "x": 207.0,
        "y": 319
      },
      "dmgType": "sharp"
    },
    "pickshovel-scoop": {
      "label": "Pickshovel Scoop",
      "sourceShape": "pickshovel",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_pickshovel_scoop.png",
      "attach": {
        "x": 195.0,
        "y": 856
      },
      "dmgType": "blunt"
    },
    "plains-blade": {
      "label": "Plains Blade",
      "sourceShape": "plainsSword",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_plains-blade.png",
      "attach": {
        "x": 194.5,
        "y": 407
      },
      "dmgType": "sharp"
    },
    "porakaneki-greatclub": {
      "label": "Porakaneki Greatclub",
      "sourceShape": "porakanekiGreatclub",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_porakaneki_greatclub.png",
      "attach": {
        "x": 181.0,
        "y": 497
      },
      "dmgType": "sharp"
    },
    "war-cleaver": {
      "label": "War Cleaver",
      "sourceShape": "warCleaver",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_war-cleaver.png",
      "attach": {
        "x": 253.5,
        "y": 611
      },
      "dmgType": "sharp"
    },
    "warhammer": {
      "label": "Warhammer",
      "sourceShape": "warhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_warhammer.png",
      "attach": {
        "x": 219.5,
        "y": 834
      },
      "dmgType": "blunt"
    },
    "work-hammer": {
      "label": "Work Hammer",
      "sourceShape": "workhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponhead_work_hammer.png",
      "attach": {
        "x": 215.0,
        "y": 860
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
          "x": 193.0,
          "y": 950,
          "rotation": 0
        },
        {
          "x": 193.0,
          "y": 250,
          "rotation": 180
        }
      ],
      "defaults": {
        "scaleX": 0.65,
        "scaleY": 0.35,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0
      },
      "overrides": {
        "plains-blade": {
          "scaleY": 0.309
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
        },
        {
          "x": 193,
          "y": 880,
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
        "rotation": 0
      },
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.464
        },
        "dagger": {
          "scaleY": 0.625
        },
        "fishing-spear": {
          "scaleY": 0.88
        },
        "harlyao-broadsword": {
          "scaleY": 0.595
        },
        "harlyao-longsword": {
          "scaleY": 0.6
        },
        "hatchet": {
          "scaleY": 0.866
        },
        "pickshovel-scoop": {
          "scaleY": 0.927
        },
        "plains-blade": {
          "scaleY": 0.4
        },
        "porakaneki-greatclub": {
          "scaleY": 0.523
        },
        "war-cleaver": {
          "scaleY": 0.669
        }
      },
      "crop": {
        "x": 0,
        "y": 640,
        "width": 450,
        "height": 248
      }
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
        "scaleX": 1,
        "scaleY": 1,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0
      },
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.841
        },
        "plains-blade": {
          "scaleY": 0.725
        },
        "porakaneki-greatclub": {
          "scaleY": 0.947
        }
      }
    },
    "fishing-spear": {
      "label": "Fishing Spear",
      "sourceShape": "fishingspear",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_fishing_spear.png",
      "attachments": [
        {
          "x": 201.0,
          "y": 931,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 0.65,
        "scaleY": 0.35,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0
      },
      "overrides": {
        "plains-blade": {
          "scaleY": 0.337
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
        "rotation": 0
      },
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.787
        },
        "plains-blade": {
          "scaleY": 0.678
        },
        "porakaneki-greatclub": {
          "scaleY": 0.886
        }
      }
    },
    "harlyao-longsword": {
      "label": "Harlyao Longsword",
      "sourceShape": "harlyaoLongsword",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_harlyao_longsword.png",
      "attachments": [
        {
          "x": 197.5,
          "y": 665,
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
        "rotation": 0
      },
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.772
        },
        "plains-blade": {
          "scaleY": 0.666
        },
        "porakaneki-greatclub": {
          "scaleY": 0.87
        }
      }
    },
    "war-cleaver": {
      "label": "War Cleaver",
      "sourceShape": "warCleaver",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_war-cleaver.png",
      "attachments": [
        {
          "x": 205.0,
          "y": 835,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 1,
        "scaleY": 0.5,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0
      },
      "overrides": {
        "plains-blade": {
          "scaleY": 0.456
        }
      }
    },
    "warhammer": {
      "label": "Warhammer",
      "sourceShape": "warhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_warhammer.png",
      "attachments": [
        {
          "x": 202.5,
          "y": 1003,
          "rotation": 0
        }
      ],
      "defaults": {
        "scaleX": 0.65,
        "scaleY": 0.35,
        "flipX": false,
        "flipY": false,
        "x": 0,
        "y": 0,
        "rotation": 0
      },
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.288
        },
        "plains-blade": {
          "scaleY": 0.248
        },
        "porakaneki-greatclub": {
          "scaleY": 0.324
        }
      }
    }
  }
};
