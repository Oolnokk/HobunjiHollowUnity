// Foundry directed mount lines and per-combination corrections.
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
          "y": 447
        }
      },
      "editorOnly": false
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
          "x": 209,
          "y": 866
        },
        "end": {
          "x": 209,
          "y": 787
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
      "craftDisabled": true,
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
        "type": "blade",
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
      },
      "editorOnly": false
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
          "x": 210,
          "y": 952
        },
        "end": {
          "x": 210,
          "y": 872
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "junction": "band",
                "x": 185,
                "y": 246.5,
                "rotation": 0,
                "scale": 0.6
              },
              {
                "junction": "band",
                "x": 187,
                "y": 281,
                "rotation": 0,
                "scale": 0.6
              },
              {
                "junction": "band",
                "x": 193,
                "y": 987.5,
                "rotation": 0,
                "scale": 0.6
              },
              {
                "junction": "band",
                "x": 192.5,
                "y": 945.5,
                "rotation": 0,
                "scale": 0.6
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    191,
                    945
                  ],
                  [
                    190,
                    945
                  ],
                  [
                    188.5,
                    944.5
                  ],
                  [
                    187,
                    944
                  ],
                  [
                    185.5,
                    944
                  ],
                  [
                    184.5,
                    944
                  ],
                  [
                    184,
                    945
                  ],
                  [
                    185.5,
                    950
                  ],
                  [
                    189,
                    959.5
                  ],
                  [
                    192.5,
                    971
                  ],
                  [
                    193,
                    974.5
                  ],
                  [
                    193.5,
                    978
                  ],
                  [
                    194.5,
                    983
                  ],
                  [
                    194.5,
                    984
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    210.5,
                    943
                  ],
                  [
                    210,
                    944
                  ],
                  [
                    209.5,
                    945
                  ],
                  [
                    209.5,
                    946.5
                  ],
                  [
                    209,
                    948.5
                  ],
                  [
                    209,
                    954
                  ],
                  [
                    209,
                    962
                  ],
                  [
                    209.5,
                    966.5
                  ],
                  [
                    210.5,
                    969.5
                  ],
                  [
                    211,
                    971
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    190,
                    964.5
                  ],
                  [
                    188.5,
                    965.5
                  ],
                  [
                    187.5,
                    965.5
                  ],
                  [
                    186,
                    966
                  ],
                  [
                    185,
                    966
                  ],
                  [
                    183.5,
                    966.5
                  ],
                  [
                    182.5,
                    967
                  ],
                  [
                    181.5,
                    967
                  ],
                  [
                    181.5,
                    966
                  ],
                  [
                    181.5,
                    967
                  ],
                  [
                    181.5,
                    969
                  ],
                  [
                    181.5,
                    970.5
                  ],
                  [
                    182,
                    972
                  ],
                  [
                    182,
                    972.5
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    189,
                    255
                  ],
                  [
                    188,
                    256
                  ],
                  [
                    187,
                    257.5
                  ],
                  [
                    187,
                    259.5
                  ],
                  [
                    187.5,
                    262
                  ],
                  [
                    188,
                    264
                  ],
                  [
                    188.5,
                    265.5
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    181.5,
                    242
                  ],
                  [
                    180.5,
                    242
                  ],
                  [
                    179.5,
                    243
                  ],
                  [
                    178,
                    244.5
                  ],
                  [
                    177.5,
                    245.5
                  ],
                  [
                    177,
                    246.5
                  ],
                  [
                    176.5,
                    248
                  ],
                  [
                    176,
                    249.5
                  ],
                  [
                    176,
                    252
                  ],
                  [
                    176,
                    254.5
                  ],
                  [
                    176,
                    256.5
                  ],
                  [
                    176.5,
                    259
                  ],
                  [
                    177,
                    261
                  ],
                  [
                    178,
                    262
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    194,
                    242
                  ],
                  [
                    194,
                    244
                  ],
                  [
                    193.5,
                    246
                  ],
                  [
                    193.5,
                    248
                  ],
                  [
                    193.5,
                    250.5
                  ],
                  [
                    193.5,
                    253
                  ],
                  [
                    193.5,
                    255
                  ],
                  [
                    194,
                    257
                  ],
                  [
                    194.5,
                    259
                  ],
                  [
                    195,
                    261
                  ],
                  [
                    195.5,
                    262.5
                  ],
                  [
                    196.5,
                    264.5
                  ],
                  [
                    196.5,
                    265.5
                  ],
                  [
                    197.5,
                    268
                  ],
                  [
                    197.5,
                    270
                  ],
                  [
                    198.5,
                    273
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    173.5,
                    252.5
                  ],
                  [
                    172.5,
                    254.5
                  ],
                  [
                    171.5,
                    256
                  ],
                  [
                    171,
                    257.5
                  ],
                  [
                    171,
                    258.5
                  ],
                  [
                    171,
                    259.5
                  ],
                  [
                    170.5,
                    260.5
                  ],
                  [
                    170.5,
                    262
                  ],
                  [
                    171,
                    263
                  ],
                  [
                    171,
                    265.5
                  ],
                  [
                    172,
                    267.5
                  ],
                  [
                    173,
                    271.5
                  ],
                  [
                    175,
                    278.5
                  ],
                  [
                    175.5,
                    282
                  ],
                  [
                    176,
                    285
                  ],
                  [
                    176,
                    289.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 1452641045,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    191,
                    960.5
                  ],
                  [
                    191,
                    959.5
                  ],
                  [
                    190,
                    958.5
                  ],
                  [
                    189,
                    958
                  ],
                  [
                    188,
                    957.5
                  ],
                  [
                    187,
                    957
                  ],
                  [
                    186,
                    957.5
                  ],
                  [
                    186,
                    958.5
                  ],
                  [
                    186,
                    960
                  ],
                  [
                    186.5,
                    962.5
                  ],
                  [
                    188,
                    967
                  ],
                  [
                    192.5,
                    973.5
                  ],
                  [
                    198,
                    978
                  ],
                  [
                    200,
                    979
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 1022056883,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    200.5,
                    946
                  ],
                  [
                    199.5,
                    945.5
                  ],
                  [
                    198.5,
                    946
                  ],
                  [
                    198,
                    947
                  ],
                  [
                    197.5,
                    948.5
                  ],
                  [
                    197.5,
                    950.5
                  ],
                  [
                    197.5,
                    953
                  ],
                  [
                    197.5,
                    956
                  ],
                  [
                    197.5,
                    958.5
                  ],
                  [
                    198,
                    961
                  ],
                  [
                    198.5,
                    963.5
                  ],
                  [
                    199,
                    965
                  ],
                  [
                    199.5,
                    966.5
                  ],
                  [
                    200,
                    967.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 1635777470,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    196.5,
                    948
                  ],
                  [
                    195.5,
                    947.5
                  ],
                  [
                    193.5,
                    946.5
                  ],
                  [
                    192.5,
                    946.5
                  ],
                  [
                    191,
                    946
                  ],
                  [
                    190,
                    946.5
                  ],
                  [
                    190,
                    948.5
                  ],
                  [
                    190.5,
                    950.5
                  ],
                  [
                    190.5,
                    952
                  ],
                  [
                    191,
                    955
                  ],
                  [
                    192,
                    962
                  ],
                  [
                    193,
                    968
                  ],
                  [
                    193,
                    972
                  ],
                  [
                    193.5,
                    976.5
                  ],
                  [
                    195,
                    981.5
                  ],
                  [
                    196.5,
                    986.5
                  ],
                  [
                    197.5,
                    991.5
                  ],
                  [
                    199,
                    995
                  ],
                  [
                    200.5,
                    998
                  ],
                  [
                    201.5,
                    997.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 110972221,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    199.5,
                    937
                  ],
                  [
                    198.5,
                    938
                  ],
                  [
                    197.5,
                    940
                  ],
                  [
                    197.5,
                    941.5
                  ],
                  [
                    197.5,
                    943
                  ],
                  [
                    197,
                    949
                  ],
                  [
                    196.5,
                    957
                  ],
                  [
                    196.5,
                    962.5
                  ],
                  [
                    197.5,
                    967
                  ],
                  [
                    199.5,
                    971
                  ],
                  [
                    203,
                    975
                  ],
                  [
                    207,
                    979
                  ],
                  [
                    212,
                    983
                  ],
                  [
                    216,
                    988
                  ],
                  [
                    218,
                    990.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 851379683,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    161,
                    255.5
                  ],
                  [
                    159.5,
                    256
                  ],
                  [
                    158.5,
                    257
                  ],
                  [
                    157.5,
                    257.5
                  ],
                  [
                    157,
                    258.5
                  ],
                  [
                    157,
                    261
                  ],
                  [
                    159,
                    268.5
                  ],
                  [
                    164,
                    279.5
                  ],
                  [
                    168.5,
                    290.5
                  ],
                  [
                    173,
                    300.5
                  ],
                  [
                    177.5,
                    309.5
                  ],
                  [
                    181.5,
                    317
                  ],
                  [
                    184.5,
                    323.5
                  ],
                  [
                    188,
                    329
                  ],
                  [
                    193,
                    334
                  ],
                  [
                    199,
                    337.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 1301440956,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    207.5,
                    281
                  ],
                  [
                    207,
                    279.5
                  ],
                  [
                    204.5,
                    275.5
                  ],
                  [
                    199.5,
                    267.5
                  ],
                  [
                    195,
                    258
                  ],
                  [
                    193,
                    249
                  ],
                  [
                    191.5,
                    239
                  ],
                  [
                    190.5,
                    228
                  ],
                  [
                    190.5,
                    216
                  ],
                  [
                    191,
                    204
                  ],
                  [
                    192,
                    191.5
                  ],
                  [
                    193,
                    185
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 2119810200,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    199,
                    905
                  ],
                  [
                    198,
                    905
                  ],
                  [
                    198.5,
                    906
                  ],
                  [
                    200,
                    910.5
                  ],
                  [
                    202.5,
                    922.5
                  ],
                  [
                    203.5,
                    937.5
                  ],
                  [
                    203,
                    952
                  ],
                  [
                    203,
                    967
                  ],
                  [
                    204,
                    979.5
                  ],
                  [
                    206.5,
                    991
                  ],
                  [
                    210.5,
                    1002
                  ],
                  [
                    215.5,
                    1013
                  ],
                  [
                    220,
                    1025.5
                  ],
                  [
                    224.5,
                    1039
                  ],
                  [
                    229,
                    1054.5
                  ],
                  [
                    231.5,
                    1063
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "revert",
                "strength": 0.5,
                "seed": 1331096737,
                "points": [
                  [
                    157.5,
                    1012
                  ],
                  [
                    156.5,
                    1012
                  ],
                  [
                    155.5,
                    1012
                  ],
                  [
                    154.5,
                    1011.5
                  ],
                  [
                    153.5,
                    1009
                  ],
                  [
                    152,
                    1002
                  ],
                  [
                    150,
                    991
                  ],
                  [
                    147.5,
                    979
                  ],
                  [
                    143.5,
                    964.5
                  ],
                  [
                    135,
                    939.5
                  ],
                  [
                    127.5,
                    913.5
                  ],
                  [
                    124,
                    891
                  ],
                  [
                    123.5,
                    872.5
                  ],
                  [
                    124.5,
                    859
                  ],
                  [
                    125.5,
                    846.5
                  ],
                  [
                    129,
                    832
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "revert",
                "strength": 0.5,
                "seed": 1679125940,
                "points": [
                  [
                    172,
                    997.5
                  ],
                  [
                    170.5,
                    997.5
                  ],
                  [
                    169.5,
                    998
                  ],
                  [
                    168,
                    998.5
                  ],
                  [
                    166.5,
                    999.5
                  ],
                  [
                    165.5,
                    999.5
                  ],
                  [
                    164.5,
                    996.5
                  ],
                  [
                    163.5,
                    989.5
                  ],
                  [
                    163,
                    980
                  ],
                  [
                    162,
                    972.5
                  ],
                  [
                    161,
                    966.5
                  ],
                  [
                    160,
                    959
                  ],
                  [
                    158.5,
                    951
                  ],
                  [
                    157.5,
                    943
                  ],
                  [
                    156,
                    935
                  ],
                  [
                    154,
                    927
                  ],
                  [
                    152.5,
                    920
                  ],
                  [
                    151,
                    914
                  ],
                  [
                    149.5,
                    909.5
                  ],
                  [
                    149,
                    904.5
                  ],
                  [
                    149,
                    899.5
                  ],
                  [
                    149.5,
                    895
                  ],
                  [
                    149.5,
                    891.5
                  ],
                  [
                    150,
                    889
                  ],
                  [
                    150.5,
                    887.5
                  ],
                  [
                    151,
                    886.5
                  ],
                  [
                    152.5,
                    898
                  ],
                  [
                    156.5,
                    940
                  ],
                  [
                    158.5,
                    994
                  ],
                  [
                    155.5,
                    1032
                  ],
                  [
                    151.5,
                    1060
                  ],
                  [
                    149.5,
                    1083.5
                  ],
                  [
                    150,
                    1104.5
                  ],
                  [
                    152.5,
                    1122.5
                  ],
                  [
                    156,
                    1134.5
                  ],
                  [
                    160,
                    1143.5
                  ],
                  [
                    164,
                    1151.5
                  ],
                  [
                    168.5,
                    1156.5
                  ],
                  [
                    171,
                    1158.5
                  ]
                ]
              },
              {
                "r": 33,
                "smudge": true,
                "points": [
                  [
                    207.5,
                    277
                  ],
                  [
                    209,
                    278
                  ],
                  [
                    210.5,
                    278
                  ]
                ]
              },
              {
                "r": 19,
                "smudge": true,
                "points": [
                  [
                    221.5,
                    256.5
                  ],
                  [
                    220,
                    256
                  ],
                  [
                    218,
                    256
                  ],
                  [
                    216.5,
                    256
                  ],
                  [
                    215,
                    256.5
                  ],
                  [
                    213,
                    257
                  ],
                  [
                    211.5,
                    257
                  ],
                  [
                    209.5,
                    257.5
                  ],
                  [
                    207.5,
                    257.5
                  ],
                  [
                    206,
                    257.5
                  ],
                  [
                    204.5,
                    257.5
                  ],
                  [
                    204,
                    257.5
                  ]
                ]
              },
              {
                "r": 19,
                "smudge": true,
                "points": [
                  [
                    224.5,
                    276
                  ],
                  [
                    223.5,
                    276
                  ],
                  [
                    222.5,
                    276.5
                  ],
                  [
                    221.5,
                    276.5
                  ],
                  [
                    220.5,
                    276.5
                  ],
                  [
                    219.5,
                    277
                  ],
                  [
                    217.5,
                    277.5
                  ],
                  [
                    216,
                    278
                  ],
                  [
                    214.5,
                    278.5
                  ],
                  [
                    213,
                    279
                  ],
                  [
                    211.5,
                    279
                  ],
                  [
                    209.5,
                    279
                  ],
                  [
                    208,
                    279
                  ],
                  [
                    206.5,
                    278.5
                  ],
                  [
                    205,
                    278
                  ],
                  [
                    203.5,
                    277
                  ],
                  [
                    202,
                    276.5
                  ]
                ]
              },
              {
                "r": 19,
                "tool": "revert",
                "strength": 1,
                "seed": 578351608,
                "points": [
                  [
                    270,
                    272
                  ],
                  [
                    269,
                    271.5
                  ],
                  [
                    268,
                    271.5
                  ],
                  [
                    266.5,
                    271
                  ],
                  [
                    265.5,
                    271
                  ],
                  [
                    263.5,
                    271
                  ],
                  [
                    262.5,
                    271.5
                  ],
                  [
                    260.5,
                    271.5
                  ],
                  [
                    258,
                    271.5
                  ],
                  [
                    256,
                    271.5
                  ],
                  [
                    254,
                    271.5
                  ],
                  [
                    251.5,
                    271.5
                  ],
                  [
                    249.5,
                    271
                  ],
                  [
                    248,
                    271
                  ],
                  [
                    246.5,
                    271
                  ],
                  [
                    245,
                    271
                  ],
                  [
                    244,
                    271
                  ],
                  [
                    240.5,
                    271.5
                  ],
                  [
                    238.5,
                    272
                  ],
                  [
                    236,
                    272.5
                  ],
                  [
                    234,
                    273
                  ]
                ]
              },
              {
                "r": 19,
                "tool": "revert",
                "strength": 1,
                "seed": 1729773348,
                "points": [
                  [
                    255,
                    265.5
                  ],
                  [
                    253.5,
                    265
                  ],
                  [
                    252.5,
                    264.5
                  ],
                  [
                    251.5,
                    264
                  ],
                  [
                    250.5,
                    264
                  ],
                  [
                    249,
                    263
                  ],
                  [
                    247.5,
                    263
                  ],
                  [
                    246,
                    262.5
                  ],
                  [
                    245,
                    262.5
                  ],
                  [
                    243,
                    263
                  ],
                  [
                    242,
                    263
                  ],
                  [
                    240.5,
                    264
                  ],
                  [
                    239,
                    264.5
                  ],
                  [
                    237.5,
                    265.5
                  ],
                  [
                    236,
                    266
                  ],
                  [
                    234.5,
                    266.5
                  ],
                  [
                    233.5,
                    267
                  ],
                  [
                    231.5,
                    268
                  ],
                  [
                    229,
                    269.5
                  ],
                  [
                    229.5,
                    270
                  ]
                ]
              },
              {
                "r": 19,
                "tool": "revert",
                "strength": 1,
                "seed": 1617825640,
                "points": [
                  [
                    247.5,
                    265
                  ],
                  [
                    246.5,
                    264.5
                  ],
                  [
                    245.5,
                    264
                  ],
                  [
                    244.5,
                    263.5
                  ],
                  [
                    243.5,
                    263.5
                  ],
                  [
                    242,
                    264
                  ],
                  [
                    240.5,
                    264
                  ],
                  [
                    239.5,
                    264.5
                  ],
                  [
                    237.5,
                    265.5
                  ],
                  [
                    236,
                    266
                  ],
                  [
                    234.5,
                    266.5
                  ],
                  [
                    233,
                    267
                  ],
                  [
                    231.5,
                    267.5
                  ],
                  [
                    230,
                    267.5
                  ],
                  [
                    229,
                    267.5
                  ],
                  [
                    227.5,
                    268
                  ],
                  [
                    225.5,
                    269
                  ],
                  [
                    223.5,
                    269.5
                  ],
                  [
                    222,
                    270
                  ],
                  [
                    222,
                    271
                  ]
                ]
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          },
          "disallow": false
        },
        "dagger": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 160.49999999999997,
                  "y0": 208.5,
                  "x1": 223.00000000000003,
                  "y1": 323
                }
              },
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 159.49999999999997,
                  "y0": 941,
                  "x1": 226.00000000000003,
                  "y1": 1046.5
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          },
          "disallow": true
        },
        "fishing-mace": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "scaleX": 0.6,
          "scaleY": 1.2,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 41,
                  "y0": 73.5,
                  "x1": 349,
                  "y1": 1136.5
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          },
          "disallow": true
        },
        "harlyao-broadsword": {
          "scaleX": 0.6,
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 39.5,
                  "y0": 86,
                  "x1": 347.5,
                  "y1": 1119.5
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          },
          "disallow": true
        },
        "harlyao-longsword": {
          "scaleX": 0.8,
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-3",
                "box": {
                  "x0": 55,
                  "y0": 129,
                  "x1": 257.5,
                  "y1": 1084.5
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          },
          "disallow": true
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
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "kylie": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "pick-shovel-pick": {
          "scaleX": 0.5,
          "flipX": true,
          "flipY": true,
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 166.5,
                  "y0": 915.5,
                  "x1": 223,
                  "y1": 1026
                }
              },
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 159.5,
                  "y0": 223,
                  "x1": 216,
                  "y1": 333.5
                },
                "flipX": true
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          },
          "disallow": true
        },
        "pickshovel-scoop": {
          "scaleX": 0.4,
          "scaleY": 1.4,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-3",
                "box": {
                  "x0": 55,
                  "y0": 129,
                  "x1": 257.5,
                  "y1": 1084.5
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          },
          "disallow": true
        },
        "plains-blade": {
          "scaleX": 0.75,
          "scaleY": 0.5,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-3",
                "box": {
                  "x0": 55,
                  "y0": 129,
                  "x1": 257.5,
                  "y1": 1084.5
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          },
          "disallow": true
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-4",
                "box": {
                  "x0": 30.5,
                  "y0": 120,
                  "x1": 280.5,
                  "y1": 525
                },
                "flipX": true
              },
              {
                "recipe": "recipe-4",
                "box": {
                  "x0": 96.5,
                  "y0": 764.5,
                  "x1": 346.5,
                  "y1": 1137
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "warhammer": {
          "scaleX": 0.55,
          "scaleY": 1.9,
          "x": 7,
          "y": 15,
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "scaleX": 0.375,
          "scaleY": 2,
          "y": -35,
          "rotation": 1,
          "layerOrder": "head-over-haft"
        },
        "bshuakauitl": {
          "scaleX": 0.5,
          "scaleY": 0.9,
          "layerOrder": "head-over-haft",
          "disallow": true
        }
      },
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 188.78363094484274,
            "y": 1002.7014180723676
          },
          "end": {
            "x": 187.43604165403195,
            "y": 925.7132111631059
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
            "x": 190.2400880884385,
            "y": 966.3136175245061
          },
          "end": {
            "x": 221.7599119115615,
            "y": 941.6863824754939
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 189.87588007577142,
            "y": 278.83626571238403
          },
          "end": {
            "x": 158.12411992422858,
            "y": 303.16373428761597
          }
        }
      ],
      "maxAttachments": 8,
      "editorOnly": false
    },
    "dagger-sword": {
      "label": "Dagger Sword",
      "sourceShape": "daggerSword",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_dagger-sword.png",
      "overrides": {
        "dagger-sword": {
          "scaleY": 0.464,
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "disallow": true
        },
        "dagger": {
          "scaleY": 0.625,
          "layerOrder": "haft-over-head",
          "animation": "thrust"
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft",
          "disallow": true
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    177,
                    650.5
                  ],
                  [
                    177,
                    649.5
                  ],
                  [
                    178,
                    648
                  ],
                  [
                    178.5,
                    646
                  ],
                  [
                    180,
                    644.5
                  ],
                  [
                    181,
                    642
                  ],
                  [
                    183,
                    640.5
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    214,
                    653.5
                  ],
                  [
                    213,
                    653.5
                  ],
                  [
                    211.5,
                    654
                  ],
                  [
                    210.5,
                    654.5
                  ],
                  [
                    209.5,
                    655
                  ],
                  [
                    208.5,
                    654.5
                  ],
                  [
                    208,
                    653.5
                  ],
                  [
                    207.5,
                    651
                  ],
                  [
                    207.5,
                    649
                  ],
                  [
                    208,
                    644.5
                  ],
                  [
                    210.5,
                    637
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    184,
                    640
                  ],
                  [
                    183,
                    640.5
                  ],
                  [
                    182,
                    641
                  ],
                  [
                    181,
                    641
                  ],
                  [
                    180,
                    641
                  ],
                  [
                    178.5,
                    640.5
                  ],
                  [
                    176.5,
                    640
                  ],
                  [
                    174,
                    639.5
                  ],
                  [
                    171,
                    639
                  ],
                  [
                    169,
                    638.5
                  ],
                  [
                    166.5,
                    638.5
                  ],
                  [
                    164.5,
                    639
                  ],
                  [
                    163.5,
                    639
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    215.5,
                    645
                  ],
                  [
                    215.5,
                    643.5
                  ],
                  [
                    215.5,
                    642.5
                  ],
                  [
                    216.5,
                    642
                  ],
                  [
                    220.5,
                    642
                  ],
                  [
                    227,
                    642
                  ],
                  [
                    233,
                    641
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    202,
                    641.5
                  ],
                  [
                    200,
                    641
                  ],
                  [
                    198,
                    641
                  ],
                  [
                    197,
                    640.5
                  ],
                  [
                    196,
                    640.5
                  ],
                  [
                    194.5,
                    640
                  ],
                  [
                    193,
                    639.5
                  ],
                  [
                    188,
                    638.5
                  ],
                  [
                    180.5,
                    637
                  ],
                  [
                    173.5,
                    636.5
                  ],
                  [
                    168,
                    636
                  ],
                  [
                    162.5,
                    635
                  ],
                  [
                    158.5,
                    634
                  ],
                  [
                    154,
                    633
                  ],
                  [
                    149.5,
                    632
                  ],
                  [
                    143.5,
                    629.5
                  ],
                  [
                    140.5,
                    627.5
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    217.5,
                    654
                  ],
                  [
                    216.5,
                    654
                  ],
                  [
                    217,
                    653
                  ],
                  [
                    221.5,
                    652
                  ],
                  [
                    229.5,
                    649.5
                  ],
                  [
                    235.5,
                    648.5
                  ],
                  [
                    239,
                    647.5
                  ],
                  [
                    241,
                    646
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    189.5,
                    645.5
                  ],
                  [
                    189,
                    644.5
                  ],
                  [
                    188,
                    643
                  ],
                  [
                    188,
                    642
                  ],
                  [
                    186.5,
                    641.5
                  ],
                  [
                    185.5,
                    641
                  ],
                  [
                    183,
                    640.5
                  ],
                  [
                    175.5,
                    640
                  ],
                  [
                    166.5,
                    640
                  ],
                  [
                    158.5,
                    639.5
                  ],
                  [
                    150.5,
                    637
                  ],
                  [
                    142.5,
                    633.5
                  ],
                  [
                    134,
                    629
                  ],
                  [
                    126.5,
                    625.5
                  ],
                  [
                    122.5,
                    623.5
                  ],
                  [
                    122,
                    624
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 867591886,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    98,
                    593
                  ],
                  [
                    97,
                    594
                  ],
                  [
                    97,
                    595.5
                  ],
                  [
                    99,
                    598.5
                  ],
                  [
                    103.5,
                    606.5
                  ],
                  [
                    110.5,
                    616
                  ],
                  [
                    116.5,
                    624
                  ],
                  [
                    121,
                    632.5
                  ],
                  [
                    124,
                    640.5
                  ],
                  [
                    126,
                    648
                  ],
                  [
                    128,
                    653.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 693552102,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    265.5,
                    658
                  ],
                  [
                    264.5,
                    657.5
                  ],
                  [
                    263.5,
                    657
                  ],
                  [
                    262.5,
                    656
                  ],
                  [
                    261.5,
                    655
                  ],
                  [
                    261,
                    654
                  ],
                  [
                    262,
                    653
                  ],
                  [
                    267,
                    648.5
                  ],
                  [
                    276,
                    641.5
                  ],
                  [
                    283,
                    631.5
                  ],
                  [
                    287.5,
                    618.5
                  ],
                  [
                    290.5,
                    601
                  ],
                  [
                    292,
                    584
                  ],
                  [
                    293,
                    570
                  ],
                  [
                    297,
                    559
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 249804484,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    282.5,
                    673
                  ],
                  [
                    281,
                    672
                  ],
                  [
                    280,
                    671.5
                  ],
                  [
                    278.5,
                    671.5
                  ],
                  [
                    277.5,
                    671.5
                  ],
                  [
                    276.5,
                    671.5
                  ],
                  [
                    275.5,
                    671.5
                  ],
                  [
                    274,
                    671.5
                  ],
                  [
                    272.5,
                    671.5
                  ],
                  [
                    271,
                    672.5
                  ],
                  [
                    269,
                    673
                  ],
                  [
                    267.5,
                    673.5
                  ],
                  [
                    266,
                    674.5
                  ],
                  [
                    264.5,
                    675
                  ],
                  [
                    263,
                    676
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 1590121837,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    110.5,
                    602.5
                  ],
                  [
                    110,
                    604.5
                  ],
                  [
                    111.5,
                    607
                  ],
                  [
                    117.5,
                    614
                  ],
                  [
                    125.5,
                    620.5
                  ],
                  [
                    133.5,
                    625
                  ],
                  [
                    141.5,
                    628.5
                  ],
                  [
                    149.5,
                    630.5
                  ],
                  [
                    159,
                    631.5
                  ],
                  [
                    172.5,
                    631.5
                  ],
                  [
                    194,
                    634.5
                  ],
                  [
                    231.5,
                    646
                  ],
                  [
                    252.5,
                    653
                  ]
                ]
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "hoe": {
          "layerOrder": "head-over-haft",
          "disallow": true
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "r": 16,
                "tool": "clean",
                "strength": 0.5,
                "seed": 812123091,
                "smoothing": 2,
                "speck": 40,
                "points": [
                  [
                    376.5,
                    516.5
                  ],
                  [
                    375,
                    515.5
                  ],
                  [
                    375.5,
                    514.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "revert",
                "strength": 1,
                "seed": 984224102,
                "points": [
                  [
                    186.5,
                    668.5
                  ],
                  [
                    185.5,
                    668
                  ],
                  [
                    184.5,
                    667
                  ],
                  [
                    183.5,
                    666
                  ],
                  [
                    182.5,
                    665.5
                  ],
                  [
                    182,
                    664.5
                  ],
                  [
                    181,
                    663.5
                  ],
                  [
                    180.5,
                    662.5
                  ],
                  [
                    179,
                    660.5
                  ],
                  [
                    175.5,
                    655.5
                  ],
                  [
                    171.5,
                    648
                  ],
                  [
                    169,
                    641
                  ],
                  [
                    168,
                    635
                  ],
                  [
                    166.5,
                    629.5
                  ],
                  [
                    167.5,
                    626
                  ],
                  [
                    169.5,
                    623.5
                  ],
                  [
                    174.5,
                    623
                  ],
                  [
                    183,
                    623
                  ],
                  [
                    194,
                    624
                  ],
                  [
                    208,
                    626
                  ],
                  [
                    225.5,
                    628.5
                  ],
                  [
                    240.5,
                    631.5
                  ],
                  [
                    253.5,
                    636.5
                  ],
                  [
                    265.5,
                    643
                  ],
                  [
                    275,
                    650.5
                  ],
                  [
                    282,
                    658
                  ],
                  [
                    286,
                    666
                  ]
                ]
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "porakaneki-greatclub": {
          "scaleY": 0.523,
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "war-cleaver": {
          "x": 20,
          "layerOrder": "haft-over-head"
        },
        "warhammer": {
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "work-hammer": {
          "layerOrder": "head-over-haft",
          "disallow": true
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
      ],
      "editorOnly": true
    },
    "dagger": {
      "label": "Dagger",
      "sourceShape": "dagger",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_dagger.png",
      "overrides": {
        "dagger-sword": {
          "x": -5,
          "y": 30,
          "layerOrder": "haft-over-head",
          "animation": "thrust"
        },
        "dagger": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "disallow": true
        },
        "fishing-mace": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "layerOrder": "head-over-haft",
          "animation": "thrust",
          "disallow": true
        },
        "fishing-spear": {
          "scaleX": 0.9,
          "scaleY": 1.25,
          "layerOrder": "haft-over-head",
          "animation": "thrust"
        },
        "harlyao-broadsword": {
          "scaleY": 0.75,
          "layerOrder": "haft-over-head",
          "animation": "thrust"
        },
        "harlyao-longsword": {
          "scaleX": 1.2,
          "scaleY": 0.7,
          "x": -3,
          "y": 30,
          "layerOrder": "haft-over-head",
          "animation": "thrust"
        },
        "hatchet": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "layerOrder": "head-over-haft",
          "animation": "thrust",
          "disallow": true
        },
        "hoe": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "layerOrder": "head-over-haft",
          "animation": "thrust",
          "disallow": true
        },
        "kylie": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 30,
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "pick-shovel-pick": {
          "scaleX": 1.1,
          "scaleY": 1.2,
          "flipY": true,
          "x": 7,
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "pickshovel-scoop": {
          "scaleX": 0.65,
          "scaleY": 1.3,
          "y": -2,
          "layerOrder": "haft-over-head",
          "animation": "thrust"
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
          "layerOrder": "head-over-haft",
          "animation": "thrust",
          "disallow": true
        },
        "war-cleaver": {
          "scaleX": 1.17,
          "scaleY": 1.8,
          "x": 30,
          "y": 35,
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "disallow": true
        },
        "warhammer": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "layerOrder": "head-over-haft",
          "animation": "thrust",
          "disallow": true
        },
        "work-hammer": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "layerOrder": "head-over-haft",
          "animation": "thrust",
          "disallow": true
        },
        "bshuakauitl": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "y": 45,
          "layerOrder": "head-over-haft",
          "animation": "thrust"
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 170.5,
                  "y0": 762.5,
                  "x1": 227,
                  "y1": 873
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 60.00000000000006,
                  "y0": 592.5000000000002,
                  "x1": 367.99999999999994,
                  "y1": 1655.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "dagger": {
          "scaleX": 0.7,
          "scaleY": 0.6,
          "x": 35,
          "y": -15,
          "rotation": -90,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 170.5,
                  "y0": 762.5,
                  "x1": 227,
                  "y1": 873
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 60.00000000000006,
                  "y0": 592.5000000000002,
                  "x1": 367.99999999999994,
                  "y1": 1655.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "fishing-mace": {
          "x": 5,
          "y": 30,
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "fishing-spear": {
          "scaleX": 1.25,
          "x": 5,
          "y": 30,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 170.5,
                  "y0": 762.5,
                  "x1": 227,
                  "y1": 873
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 60.00000000000006,
                  "y0": 592.5000000000002,
                  "x1": 367.99999999999994,
                  "y1": 1655.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-broadsword": {
          "scaleX": 1.05,
          "scaleY": 0.5,
          "x": 35,
          "y": -40,
          "rotation": -90,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 170.5,
                  "y0": 762.5,
                  "x1": 227,
                  "y1": 873
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 60.00000000000006,
                  "y0": 592.5000000000002,
                  "x1": 367.99999999999994,
                  "y1": 1655.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-longsword": {
          "scaleX": 1.05,
          "scaleY": 0.5,
          "x": 40,
          "y": -35,
          "rotation": -90,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 170.5,
                  "y0": 762.5,
                  "x1": 227,
                  "y1": 873
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 60.00000000000006,
                  "y0": 592.5000000000002,
                  "x1": 367.99999999999994,
                  "y1": 1655.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 170.5,
                  "y0": 762.5,
                  "x1": 227,
                  "y1": 873
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 60.00000000000006,
                  "y0": 592.5000000000002,
                  "x1": 367.99999999999994,
                  "y1": 1655.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "pickshovel-scoop": {
          "x": 5,
          "y": 30,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 170.5,
                  "y0": 762.5,
                  "x1": 227,
                  "y1": 873
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 60.00000000000006,
                  "y0": 592.5000000000002,
                  "x1": 367.99999999999994,
                  "y1": 1655.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "plains-blade": {
          "scaleX": 1.1,
          "scaleY": 0.35,
          "x": -65,
          "y": -30,
          "rotation": -90,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 170.5,
                  "y0": 762.5,
                  "x1": 227,
                  "y1": 873
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 60.00000000000006,
                  "y0": 592.5000000000002,
                  "x1": 367.99999999999994,
                  "y1": 1655.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 170.5,
                  "y0": 762.5,
                  "x1": 227,
                  "y1": 873
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 60.00000000000006,
                  "y0": 592.5000000000002,
                  "x1": 367.99999999999994,
                  "y1": 1655.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "dagger": {
          "layerOrder": "haft-over-head",
          "animation": "thrust"
        },
        "fishing-mace": {
          "scaleX": 0.95,
          "scaleY": 1.55,
          "y": 170,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "disallow": true
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head",
          "animation": "thrust"
        },
        "harlyao-longsword": {
          "scaleX": 1.1,
          "layerOrder": "haft-over-head",
          "animation": "thrust"
        },
        "hatchet": {
          "scaleX": 0.85,
          "scaleY": 0.85,
          "y": 25,
          "layerOrder": "head-over-haft",
          "disallow": false
        },
        "hoe": {
          "layerOrder": "head-over-haft",
          "disallow": true
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
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "pickshovel-scoop": {
          "scaleX": 0.8,
          "layerOrder": "haft-over-head"
        },
        "plains-blade": {
          "scaleY": 0.5,
          "layerOrder": "haft-over-head",
          "animation": "thrust"
        },
        "porakaneki-greatclub": {
          "scaleX": 0.9,
          "scaleY": 0.75,
          "x": 3,
          "y": 220,
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head",
          "disallow": false
        },
        "warhammer": {
          "scaleX": 0.82,
          "scaleY": 1.35,
          "y": 7,
          "rotation": 1,
          "layerOrder": "head-over-haft",
          "disallow": false
        },
        "work-hammer": {
          "scaleX": 0.8,
          "scaleY": 1.1,
          "y": -5,
          "layerOrder": "head-over-haft",
          "disallow": false
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft",
          "animation": "thrust"
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
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "fishing-spear": {
          "scaleX": 0.9,
          "scaleY": 1.5,
          "layerOrder": "haft-over-head"
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head",
          "disallow": true
        },
        "hatchet": {
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "hoe": {
          "layerOrder": "head-over-haft",
          "disallow": true
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
          "layerOrder": "haft-over-head",
          "disallow": true
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
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "work-hammer": {
          "layerOrder": "head-over-haft",
          "disallow": true
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
          "layerOrder": "head-over-haft",
          "disallow": true
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
          "layerOrder": "haft-over-head",
          "disallow": true
        },
        "hatchet": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "hoe": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "layerOrder": "head-over-haft",
          "disallow": true
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
          "layerOrder": "haft-over-head",
          "disallow": true
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
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "work-hammer": {
          "scaleX": 0.9,
          "scaleY": 1.1,
          "layerOrder": "head-over-haft",
          "disallow": true
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "junction": "block",
                "x": 325,
                "y": 927.5,
                "rotation": 0,
                "scale": 2.5
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    246.5,
                    880.5
                  ],
                  [
                    244,
                    880
                  ],
                  [
                    241.5,
                    879
                  ],
                  [
                    240.5,
                    878.5
                  ],
                  [
                    239.5,
                    878
                  ],
                  [
                    239,
                    877
                  ],
                  [
                    240.5,
                    877.5
                  ],
                  [
                    242.5,
                    878.5
                  ],
                  [
                    245.5,
                    881
                  ],
                  [
                    251.5,
                    885.5
                  ],
                  [
                    258.5,
                    890
                  ],
                  [
                    265.5,
                    893.5
                  ],
                  [
                    276.5,
                    898
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    265,
                    922
                  ],
                  [
                    264,
                    922
                  ],
                  [
                    262.5,
                    921.5
                  ],
                  [
                    260.5,
                    920.5
                  ],
                  [
                    259,
                    920.5
                  ],
                  [
                    257.5,
                    920
                  ],
                  [
                    256.5,
                    920
                  ],
                  [
                    255.5,
                    920
                  ],
                  [
                    257,
                    921
                  ],
                  [
                    259.5,
                    922.5
                  ],
                  [
                    266.5,
                    925
                  ],
                  [
                    274,
                    928.5
                  ],
                  [
                    280,
                    931.5
                  ],
                  [
                    286,
                    934.5
                  ],
                  [
                    292,
                    937.5
                  ],
                  [
                    298,
                    941
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    264.5,
                    954
                  ],
                  [
                    263.5,
                    954
                  ],
                  [
                    262,
                    954.5
                  ],
                  [
                    261,
                    954.5
                  ],
                  [
                    260,
                    955
                  ],
                  [
                    259,
                    955.5
                  ],
                  [
                    258.5,
                    956.5
                  ],
                  [
                    259,
                    957.5
                  ],
                  [
                    262.5,
                    960
                  ],
                  [
                    270,
                    965
                  ],
                  [
                    277.5,
                    970
                  ],
                  [
                    282.5,
                    973
                  ],
                  [
                    286.5,
                    975
                  ],
                  [
                    290,
                    975.5
                  ],
                  [
                    293,
                    975.5
                  ],
                  [
                    296,
                    975
                  ],
                  [
                    300.5,
                    974
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    287.5,
                    937
                  ],
                  [
                    286,
                    937
                  ],
                  [
                    289,
                    938.5
                  ],
                  [
                    296,
                    941
                  ],
                  [
                    304.5,
                    943
                  ],
                  [
                    311.5,
                    944
                  ],
                  [
                    317,
                    945
                  ],
                  [
                    320.5,
                    944.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    293,
                    965.5
                  ],
                  [
                    295,
                    965
                  ],
                  [
                    296.5,
                    965
                  ],
                  [
                    302.5,
                    964.5
                  ],
                  [
                    312,
                    964
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    280,
                    910
                  ],
                  [
                    278.5,
                    909
                  ],
                  [
                    278.5,
                    908
                  ],
                  [
                    278.5,
                    907
                  ],
                  [
                    280,
                    906.5
                  ],
                  [
                    283,
                    906
                  ],
                  [
                    290,
                    905.5
                  ],
                  [
                    299,
                    907
                  ],
                  [
                    307,
                    908.5
                  ],
                  [
                    314,
                    910
                  ],
                  [
                    322,
                    911
                  ],
                  [
                    330.5,
                    911
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    289.5,
                    894
                  ],
                  [
                    289.5,
                    893
                  ],
                  [
                    291,
                    892.5
                  ],
                  [
                    293.5,
                    892
                  ],
                  [
                    300.5,
                    892.5
                  ],
                  [
                    308,
                    893.5
                  ],
                  [
                    313,
                    894
                  ],
                  [
                    317.5,
                    894
                  ],
                  [
                    323,
                    894
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    318.5,
                    967
                  ],
                  [
                    317.5,
                    965.5
                  ],
                  [
                    317.5,
                    964.5
                  ],
                  [
                    319.5,
                    963
                  ],
                  [
                    324.5,
                    962.5
                  ],
                  [
                    332,
                    961.5
                  ],
                  [
                    338.5,
                    962.5
                  ],
                  [
                    343.5,
                    962.5
                  ],
                  [
                    349,
                    962
                  ],
                  [
                    356.5,
                    961
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    332.5,
                    938
                  ],
                  [
                    333.5,
                    937.5
                  ],
                  [
                    336.5,
                    937.5
                  ],
                  [
                    343.5,
                    938
                  ],
                  [
                    352,
                    938.5
                  ],
                  [
                    356,
                    938
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    331.5,
                    900
                  ],
                  [
                    331.5,
                    898.5
                  ],
                  [
                    332.5,
                    898
                  ],
                  [
                    333.5,
                    896.5
                  ],
                  [
                    338.5,
                    894
                  ],
                  [
                    345.5,
                    890.5
                  ],
                  [
                    352.5,
                    890
                  ],
                  [
                    358.5,
                    890.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    358.5,
                    956.5
                  ],
                  [
                    359,
                    955
                  ],
                  [
                    360.5,
                    954
                  ],
                  [
                    362,
                    953
                  ],
                  [
                    363,
                    951.5
                  ],
                  [
                    367,
                    947
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    345.5,
                    928.5
                  ],
                  [
                    344.5,
                    928
                  ],
                  [
                    344.5,
                    926.5
                  ],
                  [
                    344.5,
                    925
                  ],
                  [
                    345.5,
                    924
                  ],
                  [
                    348.5,
                    920
                  ],
                  [
                    356,
                    914.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    350.5,
                    895
                  ],
                  [
                    349.5,
                    895.5
                  ],
                  [
                    348,
                    895.5
                  ],
                  [
                    347,
                    895.5
                  ],
                  [
                    346,
                    895.5
                  ],
                  [
                    345,
                    895
                  ],
                  [
                    347.5,
                    894
                  ],
                  [
                    355,
                    892.5
                  ],
                  [
                    360,
                    891
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    323,
                    992
                  ],
                  [
                    323,
                    991
                  ],
                  [
                    322.5,
                    989
                  ],
                  [
                    321.5,
                    987.5
                  ],
                  [
                    320.5,
                    984
                  ],
                  [
                    319,
                    976.5
                  ],
                  [
                    318.5,
                    968.5
                  ],
                  [
                    319.5,
                    961.5
                  ],
                  [
                    320.5,
                    955
                  ],
                  [
                    322.5,
                    950
                  ],
                  [
                    324,
                    945.5
                  ],
                  [
                    326.5,
                    944.5
                  ],
                  [
                    328,
                    945
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    281.5,
                    996
                  ],
                  [
                    282,
                    995
                  ],
                  [
                    282,
                    994
                  ],
                  [
                    282,
                    993
                  ],
                  [
                    281.5,
                    992
                  ],
                  [
                    281.5,
                    991
                  ],
                  [
                    281.5,
                    989.5
                  ],
                  [
                    282,
                    988
                  ],
                  [
                    282.5,
                    986
                  ],
                  [
                    283,
                    984.5
                  ],
                  [
                    283.5,
                    982.5
                  ],
                  [
                    283.5,
                    980.5
                  ],
                  [
                    284,
                    979
                  ],
                  [
                    284,
                    976.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    266,
                    974.5
                  ],
                  [
                    266,
                    973.5
                  ],
                  [
                    265.5,
                    971.5
                  ],
                  [
                    265,
                    970
                  ],
                  [
                    264.5,
                    967
                  ],
                  [
                    263.5,
                    961
                  ],
                  [
                    263.5,
                    954
                  ],
                  [
                    265,
                    951
                  ],
                  [
                    266.5,
                    949.5
                  ],
                  [
                    269,
                    947.5
                  ],
                  [
                    271.5,
                    946.5
                  ],
                  [
                    274.5,
                    945.5
                  ],
                  [
                    279,
                    945
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    355,
                    984.5
                  ],
                  [
                    354.5,
                    983.5
                  ],
                  [
                    353.5,
                    981.5
                  ],
                  [
                    353.5,
                    980
                  ],
                  [
                    353.5,
                    978
                  ],
                  [
                    353.5,
                    975.5
                  ],
                  [
                    354.5,
                    972
                  ],
                  [
                    357,
                    965.5
                  ],
                  [
                    360.5,
                    960.5
                  ],
                  [
                    362.5,
                    958
                  ],
                  [
                    364.5,
                    955
                  ],
                  [
                    366,
                    951.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    399,
                    970.5
                  ],
                  [
                    398,
                    971
                  ],
                  [
                    396.5,
                    971
                  ],
                  [
                    395.5,
                    970.5
                  ],
                  [
                    394.5,
                    970.5
                  ],
                  [
                    393.5,
                    969.5
                  ],
                  [
                    392.5,
                    968
                  ],
                  [
                    392,
                    967
                  ],
                  [
                    391,
                    964.5
                  ],
                  [
                    390,
                    962.5
                  ],
                  [
                    389.5,
                    960
                  ],
                  [
                    389,
                    958
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    300,
                    980
                  ],
                  [
                    298,
                    979.5
                  ],
                  [
                    297,
                    978
                  ],
                  [
                    295.5,
                    977
                  ],
                  [
                    294.5,
                    976
                  ],
                  [
                    294,
                    975
                  ],
                  [
                    294,
                    973.5
                  ],
                  [
                    294,
                    972
                  ],
                  [
                    294.5,
                    971
                  ],
                  [
                    295.5,
                    970
                  ],
                  [
                    297,
                    968.5
                  ],
                  [
                    298,
                    967.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    309.5,
                    950
                  ],
                  [
                    309.5,
                    949
                  ],
                  [
                    310,
                    948
                  ],
                  [
                    310.5,
                    946.5
                  ],
                  [
                    311,
                    945.5
                  ],
                  [
                    311.5,
                    944
                  ],
                  [
                    312,
                    942.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    298,
                    969
                  ],
                  [
                    297,
                    968
                  ],
                  [
                    296,
                    967
                  ],
                  [
                    295,
                    965.5
                  ],
                  [
                    295,
                    964
                  ],
                  [
                    295,
                    963
                  ],
                  [
                    295.5,
                    962
                  ],
                  [
                    296.5,
                    961
                  ],
                  [
                    296.5,
                    960.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    409.5,
                    968.5
                  ],
                  [
                    408.5,
                    968
                  ],
                  [
                    407,
                    967
                  ],
                  [
                    405.5,
                    967
                  ],
                  [
                    404.5,
                    965.5
                  ],
                  [
                    403,
                    964.5
                  ],
                  [
                    401.5,
                    963
                  ],
                  [
                    400,
                    962
                  ],
                  [
                    398,
                    960.5
                  ],
                  [
                    396.5,
                    959
                  ],
                  [
                    394.5,
                    958
                  ],
                  [
                    393,
                    957
                  ],
                  [
                    391,
                    955.5
                  ],
                  [
                    390,
                    954.5
                  ],
                  [
                    389,
                    953.5
                  ],
                  [
                    388,
                    953
                  ],
                  [
                    388,
                    952.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    327,
                    994
                  ],
                  [
                    325,
                    993
                  ],
                  [
                    323.5,
                    992
                  ],
                  [
                    321.5,
                    991
                  ],
                  [
                    320.5,
                    989.5
                  ],
                  [
                    320,
                    988
                  ],
                  [
                    320,
                    986.5
                  ],
                  [
                    320.5,
                    985.5
                  ],
                  [
                    321.5,
                    984
                  ],
                  [
                    323,
                    982.5
                  ],
                  [
                    324,
                    981
                  ],
                  [
                    325,
                    980
                  ],
                  [
                    325.5,
                    978.5
                  ],
                  [
                    326,
                    976.5
                  ],
                  [
                    326.5,
                    975.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    326.5,
                    990
                  ],
                  [
                    325.5,
                    989
                  ],
                  [
                    324,
                    988
                  ],
                  [
                    322.5,
                    986
                  ],
                  [
                    320.5,
                    984.5
                  ],
                  [
                    319.5,
                    983
                  ],
                  [
                    318,
                    981.5
                  ],
                  [
                    317,
                    981
                  ],
                  [
                    316.5,
                    980
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    201,
                    955
                  ],
                  [
                    200,
                    954
                  ],
                  [
                    199.5,
                    953
                  ],
                  [
                    200,
                    952
                  ],
                  [
                    202,
                    951.5
                  ],
                  [
                    207,
                    950
                  ],
                  [
                    214.5,
                    946.5
                  ],
                  [
                    221,
                    944
                  ],
                  [
                    224.5,
                    941.5
                  ],
                  [
                    226.5,
                    937.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    383.5,
                    978.5
                  ],
                  [
                    382.5,
                    978
                  ],
                  [
                    381.5,
                    976.5
                  ],
                  [
                    381,
                    975
                  ],
                  [
                    380.5,
                    972.5
                  ],
                  [
                    380.5,
                    970.5
                  ],
                  [
                    381,
                    967.5
                  ],
                  [
                    381.5,
                    965.5
                  ],
                  [
                    381.5,
                    963.5
                  ],
                  [
                    382,
                    962
                  ],
                  [
                    382,
                    961
                  ],
                  [
                    382,
                    960
                  ],
                  [
                    381.5,
                    959
                  ],
                  [
                    382,
                    958.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    311.5,
                    989
                  ],
                  [
                    311,
                    988
                  ],
                  [
                    310.5,
                    987
                  ],
                  [
                    309.5,
                    985.5
                  ],
                  [
                    309,
                    984.5
                  ],
                  [
                    308.5,
                    983
                  ],
                  [
                    308,
                    981
                  ],
                  [
                    307.5,
                    979.5
                  ],
                  [
                    307,
                    977
                  ],
                  [
                    306.5,
                    975.5
                  ],
                  [
                    307,
                    974
                  ],
                  [
                    307.5,
                    972.5
                  ],
                  [
                    307.5,
                    972
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    390,
                    963
                  ],
                  [
                    388.5,
                    963
                  ],
                  [
                    387.5,
                    962
                  ],
                  [
                    386,
                    960.5
                  ],
                  [
                    385,
                    959.5
                  ],
                  [
                    385,
                    958.5
                  ],
                  [
                    384,
                    957.5
                  ],
                  [
                    384,
                    956.5
                  ],
                  [
                    382.5,
                    955.5
                  ],
                  [
                    382,
                    954.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    405,
                    888
                  ],
                  [
                    404,
                    888
                  ],
                  [
                    401.5,
                    887
                  ],
                  [
                    399.5,
                    886.5
                  ],
                  [
                    398,
                    886
                  ],
                  [
                    396,
                    886.5
                  ],
                  [
                    394.5,
                    887
                  ],
                  [
                    393.5,
                    887.5
                  ],
                  [
                    392,
                    888
                  ],
                  [
                    391,
                    889
                  ],
                  [
                    390,
                    889.5
                  ],
                  [
                    389,
                    889.5
                  ],
                  [
                    389.5,
                    891
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    386,
                    983.5
                  ],
                  [
                    384.5,
                    983
                  ],
                  [
                    382.5,
                    982
                  ],
                  [
                    380,
                    981
                  ],
                  [
                    378,
                    980
                  ],
                  [
                    376,
                    979.5
                  ],
                  [
                    374.5,
                    978
                  ],
                  [
                    373,
                    976
                  ],
                  [
                    372,
                    975
                  ],
                  [
                    371,
                    973.5
                  ],
                  [
                    370,
                    971.5
                  ],
                  [
                    369,
                    970.5
                  ],
                  [
                    368,
                    969
                  ],
                  [
                    367.5,
                    967.5
                  ],
                  [
                    368,
                    965.5
                  ],
                  [
                    368.5,
                    965
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    306,
                    974
                  ],
                  [
                    305.5,
                    972
                  ],
                  [
                    305.5,
                    971
                  ],
                  [
                    305.5,
                    969
                  ],
                  [
                    305.5,
                    967.5
                  ],
                  [
                    306.5,
                    966.5
                  ],
                  [
                    307,
                    965.5
                  ],
                  [
                    308,
                    964.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    349,
                    844
                  ],
                  [
                    348,
                    844
                  ],
                  [
                    346.5,
                    844
                  ],
                  [
                    345.5,
                    844
                  ],
                  [
                    344.5,
                    845.5
                  ],
                  [
                    344.5,
                    847
                  ],
                  [
                    344.5,
                    849.5
                  ],
                  [
                    345,
                    855
                  ],
                  [
                    346.5,
                    863
                  ],
                  [
                    349,
                    868.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    388.5,
                    838.5
                  ],
                  [
                    387,
                    839
                  ],
                  [
                    385.5,
                    840
                  ],
                  [
                    384,
                    841
                  ],
                  [
                    382,
                    842.5
                  ],
                  [
                    381,
                    844
                  ],
                  [
                    380,
                    846
                  ],
                  [
                    379,
                    847.5
                  ],
                  [
                    379,
                    850
                  ],
                  [
                    379,
                    852.5
                  ],
                  [
                    379,
                    855
                  ],
                  [
                    379,
                    858
                  ],
                  [
                    379,
                    860
                  ],
                  [
                    379.5,
                    862.5
                  ],
                  [
                    380,
                    864
                  ],
                  [
                    380.5,
                    865.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    306,
                    851.5
                  ],
                  [
                    305.5,
                    853
                  ],
                  [
                    304.5,
                    853.5
                  ],
                  [
                    303.5,
                    855
                  ],
                  [
                    303,
                    856
                  ],
                  [
                    302.5,
                    857.5
                  ],
                  [
                    302.5,
                    859
                  ],
                  [
                    302.5,
                    860.5
                  ],
                  [
                    303.5,
                    862
                  ],
                  [
                    304.5,
                    864
                  ],
                  [
                    306,
                    865
                  ],
                  [
                    307.5,
                    867
                  ],
                  [
                    308.5,
                    868.5
                  ],
                  [
                    309,
                    869.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    272.5,
                    851.5
                  ],
                  [
                    272,
                    852.5
                  ],
                  [
                    271,
                    853
                  ],
                  [
                    269,
                    853.5
                  ],
                  [
                    268,
                    854.5
                  ],
                  [
                    267,
                    854.5
                  ],
                  [
                    266,
                    855
                  ],
                  [
                    265,
                    855.5
                  ],
                  [
                    264,
                    855.5
                  ],
                  [
                    263,
                    856
                  ],
                  [
                    262,
                    856.5
                  ],
                  [
                    261,
                    857.5
                  ],
                  [
                    260,
                    858.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    173.5,
                    937
                  ],
                  [
                    174,
                    935.5
                  ],
                  [
                    175,
                    934
                  ],
                  [
                    176.5,
                    932.5
                  ],
                  [
                    178,
                    931.5
                  ],
                  [
                    183,
                    928.5
                  ],
                  [
                    186.5,
                    927
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    145,
                    874
                  ],
                  [
                    146,
                    874.5
                  ],
                  [
                    148.5,
                    874.5
                  ],
                  [
                    155.5,
                    873
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    207,
                    1001.5
                  ],
                  [
                    208,
                    1000.5
                  ],
                  [
                    211,
                    998.5
                  ],
                  [
                    221.5,
                    995.5
                  ],
                  [
                    229.5,
                    994
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    353.5,
                    990
                  ],
                  [
                    352.5,
                    990.5
                  ],
                  [
                    350.5,
                    990.5
                  ],
                  [
                    347,
                    990
                  ],
                  [
                    338.5,
                    989
                  ],
                  [
                    329.5,
                    986.5
                  ],
                  [
                    321,
                    983.5
                  ],
                  [
                    313,
                    981
                  ],
                  [
                    305.5,
                    979.5
                  ],
                  [
                    299,
                    978
                  ],
                  [
                    293,
                    976.5
                  ],
                  [
                    287,
                    976.5
                  ],
                  [
                    282,
                    976.5
                  ],
                  [
                    278.5,
                    977.5
                  ],
                  [
                    277.5,
                    978
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    319.5,
                    927
                  ],
                  [
                    319.5,
                    928
                  ],
                  [
                    319.5,
                    929.5
                  ],
                  [
                    319.5,
                    930.5
                  ],
                  [
                    319.5,
                    932
                  ],
                  [
                    320,
                    933
                  ],
                  [
                    320,
                    934.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    313,
                    808.5
                  ],
                  [
                    312,
                    808.5
                  ],
                  [
                    310,
                    808
                  ],
                  [
                    309,
                    808
                  ],
                  [
                    308,
                    808
                  ],
                  [
                    307.5,
                    809.5
                  ],
                  [
                    308,
                    811
                  ],
                  [
                    310.5,
                    816
                  ],
                  [
                    314,
                    823.5
                  ],
                  [
                    316,
                    829.5
                  ],
                  [
                    317.5,
                    835
                  ],
                  [
                    319.5,
                    840.5
                  ],
                  [
                    320.5,
                    844.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    267,
                    932.5
                  ],
                  [
                    267.5,
                    934
                  ],
                  [
                    268,
                    935.5
                  ],
                  [
                    269,
                    937
                  ],
                  [
                    270,
                    938.5
                  ],
                  [
                    271,
                    939.5
                  ],
                  [
                    271.5,
                    939.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    301,
                    931
                  ],
                  [
                    301,
                    932
                  ],
                  [
                    301.5,
                    933
                  ],
                  [
                    302,
                    934.5
                  ],
                  [
                    302.5,
                    936
                  ],
                  [
                    303.5,
                    937
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    329.5,
                    937
                  ],
                  [
                    331.5,
                    937.5
                  ],
                  [
                    334,
                    937.5
                  ],
                  [
                    338,
                    937
                  ],
                  [
                    347.5,
                    936.5
                  ],
                  [
                    355.5,
                    937
                  ],
                  [
                    359,
                    937.5
                  ],
                  [
                    362,
                    938.5
                  ],
                  [
                    368,
                    941
                  ],
                  [
                    373,
                    943.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    363.5,
                    906
                  ],
                  [
                    363,
                    904.5
                  ],
                  [
                    364,
                    903.5
                  ],
                  [
                    368.5,
                    902
                  ],
                  [
                    376,
                    900
                  ],
                  [
                    384,
                    900
                  ],
                  [
                    389.5,
                    901.5
                  ],
                  [
                    394,
                    902.5
                  ],
                  [
                    396,
                    903.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    354.5,
                    937.5
                  ],
                  [
                    354,
                    938.5
                  ],
                  [
                    354,
                    939.5
                  ],
                  [
                    356.5,
                    940.5
                  ],
                  [
                    363.5,
                    941.5
                  ],
                  [
                    374,
                    942.5
                  ],
                  [
                    382,
                    943.5
                  ],
                  [
                    389,
                    944
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    413.5,
                    885.5
                  ],
                  [
                    412.5,
                    886
                  ],
                  [
                    412,
                    887
                  ],
                  [
                    410.5,
                    888
                  ],
                  [
                    409,
                    889.5
                  ],
                  [
                    406.5,
                    891
                  ],
                  [
                    399.5,
                    894
                  ],
                  [
                    396,
                    896.5
                  ],
                  [
                    394.5,
                    896.5
                  ],
                  [
                    393.5,
                    897
                  ],
                  [
                    393,
                    897
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    435.5,
                    953
                  ],
                  [
                    434.5,
                    953
                  ],
                  [
                    433,
                    953
                  ],
                  [
                    431.5,
                    953.5
                  ],
                  [
                    429.5,
                    953.5
                  ],
                  [
                    427.5,
                    953.5
                  ],
                  [
                    425.5,
                    953
                  ],
                  [
                    423.5,
                    952.5
                  ],
                  [
                    421.5,
                    952
                  ],
                  [
                    419.5,
                    951
                  ],
                  [
                    417.5,
                    950.5
                  ],
                  [
                    415,
                    950
                  ],
                  [
                    413,
                    950
                  ],
                  [
                    411.5,
                    950
                  ],
                  [
                    410,
                    950
                  ],
                  [
                    409,
                    949.5
                  ],
                  [
                    408.5,
                    949.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    401.5,
                    973
                  ],
                  [
                    400,
                    972
                  ],
                  [
                    398.5,
                    971
                  ],
                  [
                    397,
                    969
                  ],
                  [
                    394.5,
                    964
                  ],
                  [
                    393,
                    956.5
                  ],
                  [
                    393.5,
                    950
                  ],
                  [
                    395,
                    945.5
                  ],
                  [
                    396.5,
                    943.5
                  ],
                  [
                    397.5,
                    941.5
                  ],
                  [
                    398.5,
                    939.5
                  ],
                  [
                    399.5,
                    938
                  ],
                  [
                    400.5,
                    936.5
                  ],
                  [
                    401.5,
                    934.5
                  ],
                  [
                    402,
                    933.5
                  ],
                  [
                    403,
                    932
                  ],
                  [
                    404,
                    931.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    353.5,
                    995
                  ],
                  [
                    354,
                    993.5
                  ],
                  [
                    353.5,
                    992.5
                  ],
                  [
                    353,
                    991
                  ],
                  [
                    353,
                    989
                  ],
                  [
                    354,
                    984.5
                  ],
                  [
                    355,
                    976
                  ],
                  [
                    355,
                    969
                  ],
                  [
                    355,
                    964.5
                  ],
                  [
                    355.5,
                    962
                  ],
                  [
                    357,
                    960.5
                  ],
                  [
                    359,
                    960.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    296.5,
                    987.5
                  ],
                  [
                    296,
                    986
                  ],
                  [
                    296.5,
                    984.5
                  ],
                  [
                    298,
                    982.5
                  ],
                  [
                    302,
                    977
                  ],
                  [
                    307,
                    971.5
                  ],
                  [
                    308.5,
                    969
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    314,
                    991
                  ],
                  [
                    313,
                    989.5
                  ],
                  [
                    313,
                    988.5
                  ],
                  [
                    313,
                    986.5
                  ],
                  [
                    313.5,
                    983.5
                  ],
                  [
                    314,
                    976.5
                  ],
                  [
                    314.5,
                    968
                  ],
                  [
                    314.5,
                    961.5
                  ],
                  [
                    315.5,
                    957.5
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    263,
                    997.5
                  ],
                  [
                    264,
                    996.5
                  ],
                  [
                    264.5,
                    995.5
                  ],
                  [
                    265,
                    993
                  ],
                  [
                    266,
                    991
                  ],
                  [
                    266,
                    989
                  ],
                  [
                    266.5,
                    987.5
                  ],
                  [
                    266.5,
                    986.5
                  ],
                  [
                    266.5,
                    985.5
                  ],
                  [
                    267,
                    984.5
                  ],
                  [
                    267,
                    980
                  ],
                  [
                    266.5,
                    977
                  ]
                ]
              },
              {
                "r": 37,
                "smudge": true,
                "points": [
                  [
                    426.5,
                    908
                  ],
                  [
                    425.5,
                    908.5
                  ],
                  [
                    424.5,
                    909
                  ],
                  [
                    423.5,
                    910
                  ],
                  [
                    422.5,
                    910
                  ],
                  [
                    421.5,
                    911
                  ],
                  [
                    420,
                    911
                  ],
                  [
                    417.5,
                    912.5
                  ],
                  [
                    410.5,
                    915.5
                  ],
                  [
                    405,
                    916
                  ],
                  [
                    401,
                    917
                  ],
                  [
                    398,
                    916.5
                  ],
                  [
                    395.5,
                    916.5
                  ],
                  [
                    393.5,
                    916.5
                  ],
                  [
                    392,
                    918.5
                  ],
                  [
                    391.5,
                    920
                  ]
                ]
              },
              {
                "shading": true,
                "tolerance": 0.2,
                "pool": 5
              },
              {
                "shading": true,
                "tolerance": 0.12,
                "pool": 5
              },
              {
                "shading": true,
                "tolerance": 0.05,
                "pool": 5
              },
              {
                "shading": true,
                "tolerance": 0.05,
                "pool": 5
              },
              {
                "shading": true,
                "tolerance": 0.05,
                "pool": 14
              },
              {
                "revertPoint": true
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    261,
                    990.5
                  ],
                  [
                    259,
                    989
                  ],
                  [
                    257,
                    988.5
                  ],
                  [
                    255,
                    987
                  ],
                  [
                    250.5,
                    983.5
                  ],
                  [
                    245.5,
                    978
                  ],
                  [
                    241.5,
                    972
                  ],
                  [
                    237,
                    967.5
                  ],
                  [
                    231,
                    963
                  ],
                  [
                    223.5,
                    959
                  ],
                  [
                    215.5,
                    954
                  ],
                  [
                    207.5,
                    946.5
                  ],
                  [
                    196,
                    931
                  ],
                  [
                    182,
                    907
                  ],
                  [
                    174.5,
                    892.5
                  ],
                  [
                    170.5,
                    884
                  ],
                  [
                    168.5,
                    878.5
                  ],
                  [
                    168.5,
                    874.5
                  ],
                  [
                    168.5,
                    872
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    321.5,
                    911.5
                  ],
                  [
                    320.5,
                    910
                  ],
                  [
                    319,
                    909.5
                  ],
                  [
                    315.5,
                    908
                  ],
                  [
                    308.5,
                    906.5
                  ],
                  [
                    300,
                    906
                  ],
                  [
                    293,
                    907
                  ],
                  [
                    286,
                    907.5
                  ],
                  [
                    278.5,
                    909
                  ],
                  [
                    270.5,
                    910
                  ],
                  [
                    262.5,
                    909.5
                  ],
                  [
                    255,
                    908
                  ],
                  [
                    246.5,
                    905.5
                  ],
                  [
                    237,
                    901.5
                  ],
                  [
                    227.5,
                    896.5
                  ],
                  [
                    219,
                    890.5
                  ],
                  [
                    211,
                    884
                  ],
                  [
                    204.5,
                    877
                  ],
                  [
                    199.5,
                    868.5
                  ],
                  [
                    195,
                    860.5
                  ],
                  [
                    193,
                    854.5
                  ],
                  [
                    193,
                    851
                  ],
                  [
                    194,
                    851
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    293,
                    906.5
                  ],
                  [
                    291.5,
                    906
                  ],
                  [
                    290.5,
                    906
                  ],
                  [
                    288,
                    906.5
                  ],
                  [
                    281,
                    905
                  ],
                  [
                    272.5,
                    903
                  ],
                  [
                    268.5,
                    903
                  ],
                  [
                    265.5,
                    902
                  ],
                  [
                    259.5,
                    899.5
                  ],
                  [
                    253.5,
                    897
                  ],
                  [
                    248.5,
                    893
                  ],
                  [
                    243,
                    887.5
                  ],
                  [
                    237.5,
                    882.5
                  ],
                  [
                    232,
                    877
                  ],
                  [
                    226.5,
                    872
                  ],
                  [
                    221,
                    867.5
                  ],
                  [
                    215.5,
                    862.5
                  ],
                  [
                    211,
                    858
                  ],
                  [
                    208.5,
                    855.5
                  ],
                  [
                    208,
                    855
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    243.5,
                    897.5
                  ],
                  [
                    242,
                    896.5
                  ],
                  [
                    241,
                    896.5
                  ],
                  [
                    240,
                    895.5
                  ],
                  [
                    239,
                    895
                  ],
                  [
                    237.5,
                    894
                  ],
                  [
                    233,
                    890.5
                  ],
                  [
                    227,
                    886
                  ],
                  [
                    221,
                    882
                  ],
                  [
                    216,
                    878.5
                  ],
                  [
                    211,
                    875.5
                  ],
                  [
                    207,
                    872
                  ],
                  [
                    203.5,
                    868.5
                  ],
                  [
                    200,
                    864
                  ],
                  [
                    197.5,
                    862
                  ],
                  [
                    196,
                    860
                  ],
                  [
                    195.5,
                    859
                  ],
                  [
                    197.5,
                    856
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    303,
                    848.5
                  ],
                  [
                    302,
                    848.5
                  ],
                  [
                    301,
                    847
                  ],
                  [
                    300,
                    846
                  ],
                  [
                    299,
                    841
                  ],
                  [
                    297.5,
                    832.5
                  ],
                  [
                    297,
                    823
                  ],
                  [
                    297.5,
                    816
                  ],
                  [
                    297,
                    808.5
                  ],
                  [
                    296.5,
                    800
                  ],
                  [
                    296,
                    791
                  ],
                  [
                    295.5,
                    778.5
                  ],
                  [
                    295.5,
                    765.5
                  ],
                  [
                    295.5,
                    751
                  ],
                  [
                    296,
                    736
                  ],
                  [
                    296.5,
                    721.5
                  ],
                  [
                    296.5,
                    706.5
                  ],
                  [
                    297,
                    690.5
                  ],
                  [
                    297,
                    676
                  ],
                  [
                    296.5,
                    661.5
                  ],
                  [
                    296.5,
                    647
                  ],
                  [
                    296.5,
                    632.5
                  ],
                  [
                    298,
                    619.5
                  ],
                  [
                    300,
                    606.5
                  ],
                  [
                    302,
                    595.5
                  ],
                  [
                    304.5,
                    585.5
                  ],
                  [
                    307,
                    577.5
                  ],
                  [
                    309.5,
                    569.5
                  ],
                  [
                    311.5,
                    562
                  ],
                  [
                    312,
                    553.5
                  ],
                  [
                    312.5,
                    545
                  ],
                  [
                    312.5,
                    536
                  ],
                  [
                    312.5,
                    525.5
                  ],
                  [
                    312.5,
                    510.5
                  ],
                  [
                    313,
                    496.5
                  ],
                  [
                    314,
                    485
                  ],
                  [
                    314.5,
                    479
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    303,
                    870.5
                  ],
                  [
                    303.5,
                    872.5
                  ],
                  [
                    304,
                    873.5
                  ],
                  [
                    305,
                    876
                  ],
                  [
                    306,
                    877.5
                  ],
                  [
                    307,
                    878.5
                  ],
                  [
                    307.5,
                    880
                  ],
                  [
                    308.5,
                    880
                  ],
                  [
                    308,
                    876.5
                  ],
                  [
                    306,
                    866
                  ],
                  [
                    304,
                    851.5
                  ],
                  [
                    303.5,
                    838.5
                  ],
                  [
                    304,
                    825.5
                  ],
                  [
                    304.5,
                    815
                  ],
                  [
                    305,
                    805
                  ],
                  [
                    306,
                    795
                  ],
                  [
                    307.5,
                    780.5
                  ],
                  [
                    311,
                    754
                  ],
                  [
                    312.5,
                    729.5
                  ],
                  [
                    313,
                    711.5
                  ],
                  [
                    312.5,
                    694.5
                  ],
                  [
                    312.5,
                    681.5
                  ],
                  [
                    312.5,
                    670.5
                  ],
                  [
                    312,
                    660
                  ],
                  [
                    311,
                    641.5
                  ],
                  [
                    311,
                    608.5
                  ],
                  [
                    312.5,
                    575.5
                  ],
                  [
                    314.5,
                    558.5
                  ],
                  [
                    317.5,
                    549.5
                  ],
                  [
                    320,
                    541.5
                  ]
                ]
              },
              {
                "r": 16,
                "smudge": true,
                "points": [
                  [
                    307,
                    827
                  ],
                  [
                    306,
                    826.5
                  ],
                  [
                    305,
                    825.5
                  ],
                  [
                    305,
                    824.5
                  ],
                  [
                    305,
                    821
                  ],
                  [
                    305.5,
                    814
                  ],
                  [
                    306.5,
                    804.5
                  ],
                  [
                    307.5,
                    795
                  ],
                  [
                    308,
                    782.5
                  ],
                  [
                    309,
                    769.5
                  ],
                  [
                    310,
                    756
                  ],
                  [
                    311,
                    741.5
                  ],
                  [
                    311,
                    727.5
                  ],
                  [
                    309.5,
                    713.5
                  ],
                  [
                    307,
                    699.5
                  ],
                  [
                    304,
                    685
                  ],
                  [
                    301,
                    666
                  ],
                  [
                    299,
                    644.5
                  ],
                  [
                    299,
                    623
                  ],
                  [
                    300,
                    602
                  ],
                  [
                    301,
                    588.5
                  ],
                  [
                    301.5,
                    576
                  ],
                  [
                    302,
                    563.5
                  ],
                  [
                    302,
                    551.5
                  ],
                  [
                    302,
                    540.5
                  ],
                  [
                    301.5,
                    529.5
                  ],
                  [
                    301,
                    519.5
                  ],
                  [
                    301.5,
                    511
                  ],
                  [
                    303,
                    504.5
                  ],
                  [
                    304,
                    501
                  ],
                  [
                    305,
                    499.5
                  ],
                  [
                    305.5,
                    498
                  ],
                  [
                    306.5,
                    496.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "revert",
                "strength": 0.5,
                "seed": 605227801,
                "points": [
                  [
                    335,
                    433.5
                  ],
                  [
                    333.5,
                    435
                  ],
                  [
                    330,
                    439.5
                  ],
                  [
                    324,
                    454.5
                  ],
                  [
                    313,
                    498
                  ],
                  [
                    306,
                    551
                  ],
                  [
                    304,
                    592
                  ],
                  [
                    304.5,
                    632
                  ],
                  [
                    306,
                    671
                  ],
                  [
                    309,
                    705
                  ],
                  [
                    312.5,
                    739.5
                  ],
                  [
                    315,
                    774
                  ],
                  [
                    314,
                    807.5
                  ],
                  [
                    311.5,
                    837
                  ],
                  [
                    307,
                    863
                  ],
                  [
                    302.5,
                    882.5
                  ],
                  [
                    299,
                    898.5
                  ],
                  [
                    297,
                    907
                  ],
                  [
                    297,
                    911.5
                  ],
                  [
                    297.5,
                    914.5
                  ],
                  [
                    299,
                    912.5
                  ],
                  [
                    303,
                    892
                  ],
                  [
                    307.5,
                    834.5
                  ],
                  [
                    308.5,
                    759.5
                  ],
                  [
                    308,
                    687.5
                  ],
                  [
                    308.5,
                    621
                  ],
                  [
                    308.5,
                    558
                  ],
                  [
                    309,
                    496.5
                  ],
                  [
                    310.5,
                    442.5
                  ],
                  [
                    312,
                    401
                  ],
                  [
                    314.5,
                    376
                  ],
                  [
                    315.5,
                    366
                  ],
                  [
                    315.5,
                    367.5
                  ],
                  [
                    317,
                    377.5
                  ],
                  [
                    321,
                    416.5
                  ],
                  [
                    331.5,
                    503
                  ],
                  [
                    349.5,
                    598
                  ],
                  [
                    366,
                    686
                  ],
                  [
                    385,
                    761
                  ],
                  [
                    395,
                    825
                  ],
                  [
                    401,
                    880.5
                  ],
                  [
                    404.5,
                    923
                  ],
                  [
                    405.5,
                    954
                  ],
                  [
                    404.5,
                    976.5
                  ],
                  [
                    400.5,
                    999
                  ],
                  [
                    396,
                    1006
                  ],
                  [
                    394,
                    1005.5
                  ],
                  [
                    391,
                    1000
                  ],
                  [
                    384,
                    976.5
                  ],
                  [
                    367,
                    913
                  ],
                  [
                    346,
                    820.5
                  ],
                  [
                    327.5,
                    716.5
                  ],
                  [
                    315.5,
                    608.5
                  ],
                  [
                    307,
                    497.5
                  ],
                  [
                    306,
                    396
                  ],
                  [
                    310.5,
                    326.5
                  ],
                  [
                    315.5,
                    284
                  ],
                  [
                    318.5,
                    265
                  ],
                  [
                    319.5,
                    265.5
                  ],
                  [
                    319.5,
                    275.5
                  ],
                  [
                    317,
                    321.5
                  ],
                  [
                    302.5,
                    422.5
                  ],
                  [
                    289,
                    537
                  ],
                  [
                    276,
                    643.5
                  ],
                  [
                    268,
                    741
                  ],
                  [
                    270,
                    829.5
                  ],
                  [
                    279,
                    907
                  ],
                  [
                    294,
                    972.5
                  ],
                  [
                    307.5,
                    1019
                  ],
                  [
                    314,
                    1040.5
                  ],
                  [
                    315,
                    1044.5
                  ],
                  [
                    314.5,
                    1042.5
                  ],
                  [
                    313.5,
                    1038
                  ],
                  [
                    307.5,
                    999.5
                  ],
                  [
                    298,
                    886
                  ],
                  [
                    296,
                    756.5
                  ],
                  [
                    301,
                    655.5
                  ],
                  [
                    307,
                    564
                  ],
                  [
                    311.5,
                    480.5
                  ],
                  [
                    315,
                    420.5
                  ],
                  [
                    317.5,
                    402.5
                  ],
                  [
                    319,
                    410
                  ],
                  [
                    318,
                    427.5
                  ],
                  [
                    309,
                    479
                  ],
                  [
                    292.5,
                    575.5
                  ],
                  [
                    285,
                    670.5
                  ],
                  [
                    288.5,
                    759
                  ],
                  [
                    298,
                    834
                  ],
                  [
                    307,
                    886.5
                  ],
                  [
                    313.5,
                    918.5
                  ],
                  [
                    315.5,
                    927
                  ],
                  [
                    315,
                    917
                  ],
                  [
                    312.5,
                    876.5
                  ],
                  [
                    311,
                    782.5
                  ],
                  [
                    311,
                    677.5
                  ],
                  [
                    316.5,
                    599
                  ],
                  [
                    326.5,
                    549
                  ],
                  [
                    334.5,
                    528
                  ],
                  [
                    337.5,
                    528.5
                  ],
                  [
                    339.5,
                    540.5
                  ],
                  [
                    341.5,
                    563
                  ],
                  [
                    338.5,
                    621.5
                  ],
                  [
                    326.5,
                    700.5
                  ],
                  [
                    312,
                    774.5
                  ],
                  [
                    301.5,
                    844
                  ],
                  [
                    289.5,
                    897
                  ],
                  [
                    282.5,
                    928
                  ],
                  [
                    283.5,
                    943
                  ],
                  [
                    292,
                    961.5
                  ],
                  [
                    325,
                    1006
                  ],
                  [
                    386,
                    1077
                  ],
                  [
                    432,
                    1132.5
                  ],
                  [
                    474,
                    1172.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "revert",
                "strength": 0.5,
                "seed": 310193216,
                "points": [
                  [
                    296.5,
                    490
                  ],
                  [
                    295,
                    489.5
                  ],
                  [
                    294,
                    490.5
                  ],
                  [
                    292.5,
                    496.5
                  ],
                  [
                    291,
                    515.5
                  ],
                  [
                    289,
                    548
                  ],
                  [
                    288,
                    584
                  ],
                  [
                    286,
                    617.5
                  ],
                  [
                    282.5,
                    654
                  ],
                  [
                    281,
                    688
                  ],
                  [
                    279.5,
                    720
                  ],
                  [
                    279.5,
                    750.5
                  ],
                  [
                    279.5,
                    776
                  ],
                  [
                    280.5,
                    798
                  ],
                  [
                    281,
                    817.5
                  ],
                  [
                    281.5,
                    833
                  ],
                  [
                    281,
                    847
                  ],
                  [
                    281,
                    855.5
                  ],
                  [
                    281,
                    864
                  ],
                  [
                    281,
                    870
                  ],
                  [
                    281,
                    873
                  ],
                  [
                    282,
                    871.5
                  ],
                  [
                    283.5,
                    865.5
                  ],
                  [
                    290.5,
                    829.5
                  ],
                  [
                    301,
                    768
                  ],
                  [
                    309,
                    716.5
                  ],
                  [
                    314.5,
                    677
                  ],
                  [
                    318.5,
                    645
                  ],
                  [
                    319,
                    622
                  ],
                  [
                    319,
                    609.5
                  ],
                  [
                    319,
                    605.5
                  ],
                  [
                    318.5,
                    609
                  ],
                  [
                    318,
                    614.5
                  ],
                  [
                    316.5,
                    642
                  ],
                  [
                    315,
                    696.5
                  ],
                  [
                    316.5,
                    754.5
                  ],
                  [
                    320.5,
                    817
                  ],
                  [
                    326,
                    874.5
                  ],
                  [
                    328,
                    920
                  ],
                  [
                    325.5,
                    950.5
                  ],
                  [
                    321.5,
                    966.5
                  ],
                  [
                    317,
                    975.5
                  ],
                  [
                    313.5,
                    980.5
                  ],
                  [
                    311,
                    982.5
                  ],
                  [
                    307.5,
                    981.5
                  ],
                  [
                    299,
                    977.5
                  ],
                  [
                    273,
                    958.5
                  ],
                  [
                    228.5,
                    918.5
                  ],
                  [
                    186,
                    879.5
                  ],
                  [
                    155.5,
                    851.5
                  ],
                  [
                    137.5,
                    834
                  ],
                  [
                    127.5,
                    825
                  ],
                  [
                    123.5,
                    824.5
                  ],
                  [
                    123,
                    825.5
                  ],
                  [
                    124,
                    829
                  ],
                  [
                    129.5,
                    838.5
                  ],
                  [
                    153,
                    868.5
                  ],
                  [
                    201,
                    917.5
                  ],
                  [
                    247.5,
                    949
                  ],
                  [
                    288,
                    965
                  ],
                  [
                    319,
                    973
                  ],
                  [
                    342.5,
                    976.5
                  ],
                  [
                    358,
                    976
                  ],
                  [
                    367.5,
                    973
                  ],
                  [
                    373,
                    969.5
                  ],
                  [
                    376,
                    965.5
                  ],
                  [
                    377,
                    961
                  ],
                  [
                    375,
                    954.5
                  ],
                  [
                    362,
                    938
                  ],
                  [
                    324,
                    905
                  ],
                  [
                    266.5,
                    869
                  ],
                  [
                    208,
                    846.5
                  ],
                  [
                    162.5,
                    844
                  ],
                  [
                    134,
                    851
                  ],
                  [
                    118,
                    856.5
                  ],
                  [
                    112,
                    858.5
                  ],
                  [
                    116,
                    858
                  ],
                  [
                    121.5,
                    858
                  ],
                  [
                    147.5,
                    858
                  ],
                  [
                    199,
                    860
                  ],
                  [
                    263,
                    865.5
                  ],
                  [
                    324,
                    871
                  ],
                  [
                    367,
                    872.5
                  ],
                  [
                    398,
                    869.5
                  ],
                  [
                    412.5,
                    865.5
                  ],
                  [
                    422.5,
                    861
                  ],
                  [
                    430,
                    858
                  ],
                  [
                    438,
                    855.5
                  ],
                  [
                    448.5,
                    851.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "revert",
                "strength": 0.5,
                "seed": 1789660542,
                "points": [
                  [
                    131.5,
                    827.5
                  ],
                  [
                    133,
                    828.5
                  ],
                  [
                    140.5,
                    833
                  ],
                  [
                    158.5,
                    844.5
                  ],
                  [
                    184,
                    863.5
                  ],
                  [
                    209.5,
                    890.5
                  ],
                  [
                    233.5,
                    918.5
                  ],
                  [
                    246.5,
                    933
                  ],
                  [
                    252,
                    939
                  ],
                  [
                    252.5,
                    940
                  ],
                  [
                    251.5,
                    939
                  ],
                  [
                    239,
                    929
                  ],
                  [
                    204,
                    896
                  ],
                  [
                    163.5,
                    851.5
                  ],
                  [
                    133,
                    819
                  ],
                  [
                    121,
                    812
                  ],
                  [
                    121,
                    814
                  ],
                  [
                    129,
                    824
                  ],
                  [
                    157,
                    856.5
                  ],
                  [
                    198,
                    894
                  ],
                  [
                    231.5,
                    925.5
                  ],
                  [
                    253.5,
                    952
                  ],
                  [
                    273,
                    976.5
                  ],
                  [
                    282.5,
                    989
                  ],
                  [
                    285,
                    992.5
                  ],
                  [
                    282,
                    989.5
                  ],
                  [
                    259,
                    966.5
                  ],
                  [
                    212,
                    913
                  ],
                  [
                    168.5,
                    859
                  ],
                  [
                    154.5,
                    841.5
                  ],
                  [
                    153,
                    841
                  ],
                  [
                    153.5,
                    842.5
                  ],
                  [
                    155.5,
                    848.5
                  ],
                  [
                    162.5,
                    862.5
                  ],
                  [
                    190.5,
                    902
                  ],
                  [
                    247.5,
                    961
                  ],
                  [
                    303,
                    1002
                  ],
                  [
                    312.5,
                    1008.5
                  ],
                  [
                    308.5,
                    1006.5
                  ],
                  [
                    277,
                    988.5
                  ],
                  [
                    219.5,
                    946
                  ],
                  [
                    166.5,
                    905
                  ],
                  [
                    151,
                    893.5
                  ],
                  [
                    149.5,
                    894
                  ],
                  [
                    150.5,
                    895.5
                  ],
                  [
                    154.5,
                    905
                  ],
                  [
                    165.5,
                    928.5
                  ],
                  [
                    194,
                    967
                  ],
                  [
                    245.5,
                    1007
                  ],
                  [
                    293.5,
                    1025
                  ],
                  [
                    306,
                    1021.5
                  ],
                  [
                    302.5,
                    1007
                  ],
                  [
                    269.5,
                    967.5
                  ],
                  [
                    215,
                    910.5
                  ],
                  [
                    157.5,
                    861
                  ],
                  [
                    127,
                    836
                  ],
                  [
                    125.5,
                    837
                  ],
                  [
                    131,
                    847.5
                  ],
                  [
                    151,
                    875.5
                  ],
                  [
                    181.5,
                    911.5
                  ],
                  [
                    219.5,
                    944
                  ],
                  [
                    258,
                    966
                  ],
                  [
                    289,
                    980
                  ],
                  [
                    300,
                    983
                  ],
                  [
                    299,
                    979.5
                  ],
                  [
                    275.5,
                    957.5
                  ],
                  [
                    207,
                    900.5
                  ],
                  [
                    151,
                    854.5
                  ],
                  [
                    140,
                    848
                  ],
                  [
                    142,
                    850
                  ],
                  [
                    162,
                    872
                  ],
                  [
                    203.5,
                    911.5
                  ],
                  [
                    233,
                    935
                  ],
                  [
                    238.5,
                    940
                  ],
                  [
                    236,
                    939.5
                  ],
                  [
                    210,
                    925
                  ],
                  [
                    158.5,
                    878
                  ],
                  [
                    140.5,
                    855.5
                  ],
                  [
                    145,
                    852.5
                  ],
                  [
                    162.5,
                    859.5
                  ],
                  [
                    192.5,
                    881.5
                  ],
                  [
                    210.5,
                    900.5
                  ],
                  [
                    220.5,
                    910
                  ],
                  [
                    228.5,
                    921.5
                  ],
                  [
                    249,
                    946.5
                  ],
                  [
                    281,
                    970.5
                  ],
                  [
                    295.5,
                    970.5
                  ],
                  [
                    301.5,
                    963
                  ],
                  [
                    301.5,
                    958.5
                  ]
                ]
              },
              {
                "r": 16,
                "tool": "revert",
                "strength": 0.5,
                "seed": 946441564,
                "points": [
                  [
                    190,
                    832.5
                  ],
                  [
                    188,
                    834
                  ],
                  [
                    186.5,
                    837.5
                  ],
                  [
                    182,
                    846
                  ],
                  [
                    179.5,
                    855.5
                  ],
                  [
                    180.5,
                    860
                  ],
                  [
                    183,
                    863
                  ],
                  [
                    189,
                    867.5
                  ],
                  [
                    204.5,
                    877
                  ],
                  [
                    236,
                    892.5
                  ],
                  [
                    271.5,
                    906
                  ],
                  [
                    295.5,
                    914
                  ],
                  [
                    319,
                    922
                  ],
                  [
                    335,
                    926.5
                  ],
                  [
                    342,
                    928.5
                  ],
                  [
                    329.5,
                    921
                  ],
                  [
                    295,
                    906
                  ],
                  [
                    260,
                    892
                  ],
                  [
                    238,
                    885
                  ],
                  [
                    225.5,
                    882.5
                  ],
                  [
                    217.5,
                    882
                  ],
                  [
                    213.5,
                    882.5
                  ],
                  [
                    212,
                    882.5
                  ],
                  [
                    214.5,
                    883.5
                  ],
                  [
                    221.5,
                    886.5
                  ],
                  [
                    266.5,
                    907
                  ],
                  [
                    329,
                    936.5
                  ],
                  [
                    349,
                    943.5
                  ],
                  [
                    349.5,
                    942
                  ],
                  [
                    336.5,
                    933
                  ],
                  [
                    284,
                    901
                  ],
                  [
                    217.5,
                    865
                  ],
                  [
                    174,
                    855.5
                  ],
                  [
                    154.5,
                    857.5
                  ],
                  [
                    143.5,
                    862
                  ],
                  [
                    138.5,
                    865.5
                  ],
                  [
                    140,
                    869
                  ],
                  [
                    151,
                    880
                  ],
                  [
                    187,
                    913
                  ],
                  [
                    234.5,
                    950
                  ],
                  [
                    255,
                    961
                  ],
                  [
                    257.5,
                    962.5
                  ],
                  [
                    251.5,
                    956.5
                  ],
                  [
                    223.5,
                    928.5
                  ],
                  [
                    171.5,
                    872
                  ],
                  [
                    133,
                    823.5
                  ],
                  [
                    130,
                    816
                  ],
                  [
                    139.5,
                    824.5
                  ],
                  [
                    164,
                    850.5
                  ],
                  [
                    195.5,
                    885
                  ],
                  [
                    219,
                    915.5
                  ],
                  [
                    242.5,
                    946.5
                  ],
                  [
                    258.5,
                    975.5
                  ],
                  [
                    266,
                    988
                  ],
                  [
                    266,
                    989
                  ],
                  [
                    256,
                    981.5
                  ],
                  [
                    221.5,
                    944
                  ],
                  [
                    179,
                    890
                  ],
                  [
                    159,
                    851.5
                  ],
                  [
                    150.5,
                    829.5
                  ],
                  [
                    150.5,
                    826
                  ],
                  [
                    151.5,
                    828
                  ],
                  [
                    157,
                    842
                  ],
                  [
                    179.5,
                    883
                  ],
                  [
                    222.5,
                    944
                  ],
                  [
                    262,
                    980
                  ],
                  [
                    275,
                    987.5
                  ],
                  [
                    262,
                    971
                  ],
                  [
                    217,
                    916.5
                  ],
                  [
                    169.5,
                    855.5
                  ],
                  [
                    159.5,
                    840
                  ],
                  [
                    165.5,
                    845
                  ],
                  [
                    183,
                    864
                  ],
                  [
                    213,
                    898.5
                  ],
                  [
                    240.5,
                    924.5
                  ],
                  [
                    256.5,
                    941
                  ],
                  [
                    264,
                    948.5
                  ],
                  [
                    265.5,
                    950
                  ],
                  [
                    261,
                    944
                  ],
                  [
                    235.5,
                    912.5
                  ],
                  [
                    198.5,
                    870
                  ],
                  [
                    188.5,
                    851
                  ],
                  [
                    190,
                    848.5
                  ],
                  [
                    195,
                    853.5
                  ],
                  [
                    215,
                    877.5
                  ],
                  [
                    245.5,
                    914.5
                  ],
                  [
                    257,
                    930
                  ],
                  [
                    259.5,
                    933
                  ],
                  [
                    258.5,
                    931.5
                  ],
                  [
                    246.5,
                    913
                  ],
                  [
                    205.5,
                    862.5
                  ],
                  [
                    177,
                    834
                  ],
                  [
                    178.5,
                    838
                  ],
                  [
                    184,
                    849.5
                  ],
                  [
                    198,
                    875.5
                  ],
                  [
                    218,
                    905.5
                  ],
                  [
                    243,
                    928
                  ],
                  [
                    256.5,
                    936.5
                  ],
                  [
                    262,
                    938
                  ],
                  [
                    261.5,
                    936
                  ],
                  [
                    246.5,
                    917
                  ],
                  [
                    206,
                    877
                  ],
                  [
                    182,
                    857.5
                  ],
                  [
                    184,
                    860.5
                  ],
                  [
                    190.5,
                    870.5
                  ],
                  [
                    207,
                    892.5
                  ],
                  [
                    225,
                    911.5
                  ],
                  [
                    236.5,
                    919.5
                  ],
                  [
                    243,
                    923
                  ],
                  [
                    246.5,
                    923.5
                  ],
                  [
                    248.5,
                    922
                  ],
                  [
                    249.5,
                    918.5
                  ],
                  [
                    242.5,
                    903
                  ],
                  [
                    215,
                    870
                  ],
                  [
                    186,
                    843
                  ],
                  [
                    175.5,
                    835.5
                  ],
                  [
                    174,
                    834.5
                  ],
                  [
                    186,
                    849.5
                  ],
                  [
                    226.5,
                    889.5
                  ],
                  [
                    262.5,
                    915.5
                  ],
                  [
                    271.5,
                    917
                  ],
                  [
                    270.5,
                    915.5
                  ],
                  [
                    251,
                    894
                  ],
                  [
                    200,
                    849.5
                  ],
                  [
                    176.5,
                    835
                  ],
                  [
                    180.5,
                    845
                  ],
                  [
                    204.5,
                    876.5
                  ],
                  [
                    239,
                    904.5
                  ],
                  [
                    250,
                    907
                  ]
                ]
              },
              {
                "r": 136,
                "tool": "puff",
                "strength": 0.15,
                "seed": 397448306,
                "points": [
                  [
                    306.5,
                    887
                  ],
                  [
                    304.5,
                    883
                  ],
                  [
                    296.5,
                    833
                  ],
                  [
                    300,
                    802
                  ],
                  [
                    302.5,
                    777.5
                  ],
                  [
                    302.5,
                    736
                  ],
                  [
                    303.5,
                    708
                  ],
                  [
                    305.5,
                    682.5
                  ],
                  [
                    309,
                    652
                  ],
                  [
                    309.5,
                    622.5
                  ],
                  [
                    306.5,
                    596
                  ],
                  [
                    304,
                    561
                  ],
                  [
                    304,
                    536.5
                  ],
                  [
                    305.5,
                    521
                  ],
                  [
                    307.5,
                    509
                  ],
                  [
                    309.5,
                    499
                  ],
                  [
                    311,
                    491.5
                  ],
                  [
                    311,
                    486.5
                  ],
                  [
                    310.5,
                    478
                  ],
                  [
                    310,
                    466.5
                  ],
                  [
                    310.5,
                    456.5
                  ],
                  [
                    312.5,
                    444
                  ],
                  [
                    314.5,
                    437
                  ]
                ]
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          },
          "disallow": true
        },
        "dagger": {
          "layerOrder": "haft-over-head",
          "disallow": true
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head",
          "disallow": true
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head",
          "disallow": true
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head",
          "disallow": true
        },
        "hatchet": {
          "scaleY": 1.2,
          "x": 15,
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "kylie": {
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head",
          "disallow": true
        },
        "plains-blade": {
          "scaleY": 0.456,
          "layerOrder": "haft-over-head",
          "disallow": true
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head",
          "disallow": true
        },
        "warhammer": {
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "work-hammer": {
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        }
      },
      "mounts": [
        {
          "type": "tang",
          "start": {
            "x": 336.17802901260455,
            "y": 860.0223598097404
          },
          "end": {
            "x": 340.28189574430615,
            "y": 963.9488265345489
          }
        }
      ],
      "maxAttachments": 8,
      "editorOnly": true
    },
    "warhammer": {
      "label": "Warhammer",
      "sourceShape": "warhammer",
      "sprite": "assets/toolsprites/modular_pieces/weaponshaft_warhammer.png",
      "overrides": {
        "dagger-sword": {
          "x": 12,
          "y": 5,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 908.5,
                  "x1": 240,
                  "y1": 1019
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 738.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1801.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "dagger": {
          "scaleX": 0.9,
          "scaleY": 0.75,
          "x": 40,
          "y": -90,
          "rotation": -90,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 908.5,
                  "x1": 240,
                  "y1": 1019
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 738.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1801.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 908.5,
                  "x1": 240,
                  "y1": 1019
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 738.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1801.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-broadsword": {
          "scaleX": 1.35,
          "scaleY": 0.8,
          "x": 25,
          "y": -100,
          "rotation": -90,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 908.5,
                  "x1": 240,
                  "y1": 1019
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 738.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1801.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-longsword": {
          "scaleX": 1.65,
          "x": 5,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 908.5,
                  "x1": 240,
                  "y1": 1019
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 738.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1801.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 908.5,
                  "x1": 240,
                  "y1": 1019
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 738.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1801.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "pickshovel-scoop": {
          "x": 5,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 908.5,
                  "x1": 240,
                  "y1": 1019
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 738.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1801.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "plains-blade": {
          "scaleX": 1.2,
          "scaleY": 0.75,
          "x": 5,
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 908.5,
                  "x1": 240,
                  "y1": 1019
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 738.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1801.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 908.5,
                  "x1": 240,
                  "y1": 1019
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 738.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1801.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "warhammer": {
          "scaleX": 1.65,
          "x": 5,
          "layerOrder": "head-over-haft",
          "disallow": true
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
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 202.5,
                  "y0": 514.5,
                  "x1": 259,
                  "y1": 625
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 92.00000000000006,
                  "y0": 344.5000000000001,
                  "x1": 399.99999999999994,
                  "y1": 1407.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "dagger-sword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 202.5,
                  "y0": 514.5,
                  "x1": 259,
                  "y1": 625
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 92.00000000000006,
                  "y0": 344.5000000000001,
                  "x1": 399.99999999999994,
                  "y1": 1407.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 202.5,
                  "y0": 514.5,
                  "x1": 259,
                  "y1": 625
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 92.00000000000006,
                  "y0": 344.5000000000001,
                  "x1": 399.99999999999994,
                  "y1": 1407.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 202.5,
                  "y0": 514.5,
                  "x1": 259,
                  "y1": 625
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 92.00000000000006,
                  "y0": 344.5000000000001,
                  "x1": 399.99999999999994,
                  "y1": 1407.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 202.5,
                  "y0": 514.5,
                  "x1": 259,
                  "y1": 625
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 92.00000000000006,
                  "y0": 344.5000000000001,
                  "x1": 399.99999999999994,
                  "y1": 1407.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 202.5,
                  "y0": 514.5,
                  "x1": 259,
                  "y1": 625
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 92.00000000000006,
                  "y0": 344.5000000000001,
                  "x1": 399.99999999999994,
                  "y1": 1407.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 202.5,
                  "y0": 514.5,
                  "x1": 259,
                  "y1": 625
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 92.00000000000006,
                  "y0": 344.5000000000001,
                  "x1": 399.99999999999994,
                  "y1": 1407.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "plains-blade": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 202.5,
                  "y0": 514.5,
                  "x1": 259,
                  "y1": 625
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 92.00000000000006,
                  "y0": 344.5000000000001,
                  "x1": 399.99999999999994,
                  "y1": 1407.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 202.5,
                  "y0": 514.5,
                  "x1": 259,
                  "y1": 625
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 92.00000000000006,
                  "y0": 344.5000000000001,
                  "x1": 399.99999999999994,
                  "y1": 1407.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "dagger": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 916.5,
                  "x1": 240,
                  "y1": 1027
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 746.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1809.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "dagger-sword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 916.5,
                  "x1": 240,
                  "y1": 1027
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 746.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1809.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 916.5,
                  "x1": 240,
                  "y1": 1027
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 746.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1809.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 916.5,
                  "x1": 240,
                  "y1": 1027
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 746.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1809.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 916.5,
                  "x1": 240,
                  "y1": 1027
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 746.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1809.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "hoe": {
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 916.5,
                  "x1": 240,
                  "y1": 1027
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 746.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1809.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 916.5,
                  "x1": 240,
                  "y1": 1027
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 746.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1809.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "plains-blade": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 916.5,
                  "x1": 240,
                  "y1": 1027
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 746.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1809.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 183.5,
                  "y0": 916.5,
                  "x1": 240,
                  "y1": 1027
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 73.00000000000006,
                  "y0": 746.5000000000002,
                  "x1": 380.99999999999994,
                  "y1": 1809.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "dagger": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 164.5,
                  "y0": 1082.5,
                  "x1": 221,
                  "y1": 1193
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 54.00000000000006,
                  "y0": 912.5000000000002,
                  "x1": 361.99999999999994,
                  "y1": 1975.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "dagger-sword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 164.5,
                  "y0": 1082.5,
                  "x1": 221,
                  "y1": 1193
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 54.00000000000006,
                  "y0": 912.5000000000002,
                  "x1": 361.99999999999994,
                  "y1": 1975.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 164.5,
                  "y0": 1082.5,
                  "x1": 221,
                  "y1": 1193
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 54.00000000000006,
                  "y0": 912.5000000000002,
                  "x1": 361.99999999999994,
                  "y1": 1975.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 164.5,
                  "y0": 1082.5,
                  "x1": 221,
                  "y1": 1193
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 54.00000000000006,
                  "y0": 912.5000000000002,
                  "x1": 361.99999999999994,
                  "y1": 1975.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 164.5,
                  "y0": 1082.5,
                  "x1": 221,
                  "y1": 1193
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 54.00000000000006,
                  "y0": 912.5000000000002,
                  "x1": 361.99999999999994,
                  "y1": 1975.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "hatchet": {
          "layerOrder": "head-over-haft"
        },
        "kylie": {
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 164.5,
                  "y0": 1082.5,
                  "x1": 221,
                  "y1": 1193
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 54.00000000000006,
                  "y0": 912.5000000000002,
                  "x1": 361.99999999999994,
                  "y1": 1975.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 164.5,
                  "y0": 1082.5,
                  "x1": 221,
                  "y1": 1193
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 54.00000000000006,
                  "y0": 912.5000000000002,
                  "x1": 361.99999999999994,
                  "y1": 1975.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "plains-blade": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 164.5,
                  "y0": 1082.5,
                  "x1": 221,
                  "y1": 1193
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 54.00000000000006,
                  "y0": 912.5000000000002,
                  "x1": 361.99999999999994,
                  "y1": 1975.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 164.5,
                  "y0": 1082.5,
                  "x1": 221,
                  "y1": 1193
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 54.00000000000006,
                  "y0": 912.5000000000002,
                  "x1": 361.99999999999994,
                  "y1": 1975.4999999999998
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
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
          "layerOrder": "head-over-haft",
          "disallow": true
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft"
        },
        "dagger": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 338.7881062280972,
                  "y0": 908.9415575926496,
                  "x1": 398.33130614420867,
                  "y1": 1025.3933025613278
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 222.33636125941896,
                  "y0": 729.7850268716061,
                  "x1": 546.9258404481329,
                  "y1": 1850.0402748508363
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "dagger-sword": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 338.7881062280972,
                  "y0": 908.9415575926496,
                  "x1": 398.33130614420867,
                  "y1": 1025.3933025613278
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 222.33636125941896,
                  "y0": 729.7850268716061,
                  "x1": 546.9258404481329,
                  "y1": 1850.0402748508363
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "fishing-mace": {
          "scaleX": 0.75,
          "layerOrder": "head-over-haft"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 338.7881062280972,
                  "y0": 908.9415575926496,
                  "x1": 398.33130614420867,
                  "y1": 1025.3933025613278
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 222.33636125941896,
                  "y0": 729.7850268716061,
                  "x1": 546.9258404481329,
                  "y1": 1850.0402748508363
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-broadsword": {
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 338.7881062280972,
                  "y0": 908.9415575926496,
                  "x1": 398.33130614420867,
                  "y1": 1025.3933025613278
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 222.33636125941896,
                  "y0": 729.7850268716061,
                  "x1": 546.9258404481329,
                  "y1": 1850.0402748508363
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-longsword": {
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 338.7881062280972,
                  "y0": 908.9415575926496,
                  "x1": 398.33130614420867,
                  "y1": 1025.3933025613278
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 222.33636125941896,
                  "y0": 729.7850268716061,
                  "x1": 546.9258404481329,
                  "y1": 1850.0402748508363
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "hatchet": {
          "layerOrder": "head-over-haft"
        },
        "hoe": {
          "layerOrder": "head-over-haft"
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 338.7881062280972,
                  "y0": 908.9415575926496,
                  "x1": 398.33130614420867,
                  "y1": 1025.3933025613278
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 222.33636125941896,
                  "y0": 729.7850268716061,
                  "x1": 546.9258404481329,
                  "y1": 1850.0402748508363
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 338.7881062280972,
                  "y0": 908.9415575926496,
                  "x1": 398.33130614420867,
                  "y1": 1025.3933025613278
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 222.33636125941896,
                  "y0": 729.7850268716061,
                  "x1": 546.9258404481329,
                  "y1": 1850.0402748508363
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "plains-blade": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 338.7881062280972,
                  "y0": 908.9415575926496,
                  "x1": 398.33130614420867,
                  "y1": 1025.3933025613278
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 222.33636125941896,
                  "y0": 729.7850268716061,
                  "x1": 546.9258404481329,
                  "y1": 1850.0402748508363
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 338.7881062280972,
                  "y0": 908.9415575926496,
                  "x1": 398.33130614420867,
                  "y1": 1025.3933025613278
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 222.33636125941896,
                  "y0": 729.7850268716061,
                  "x1": 546.9258404481329,
                  "y1": 1850.0402748508363
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "warhammer": {
          "layerOrder": "head-over-haft"
        },
        "work-hammer": {
          "scaleX": 0.5,
          "scaleY": 2.5,
          "layerOrder": "head-over-haft"
        }
      },
      "editorOnly": false,
      "mounts": [
        {
          "type": "eye",
          "start": {
            "x": 253.96693099224976,
            "y": 955.1734838398783
          },
          "end": {
            "x": 311.3429622335276,
            "y": 953.3378664626867
          }
        },
        {
          "type": "tang",
          "start": {
            "x": 378.31953952612565,
            "y": 945.0718928356596
          },
          "end": {
            "x": 346.68046047387435,
            "y": 972.9281071643404
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
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 100,
                  "y0": 748,
                  "x1": 321,
                  "y1": 861
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 74.00000000000006,
                  "y0": 61.500000000000114,
                  "x1": 381.99999999999994,
                  "y1": 1124.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "dagger": {
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 100,
                  "y0": 748,
                  "x1": 321,
                  "y1": 861
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 74.00000000000006,
                  "y0": 61.500000000000114,
                  "x1": 381.99999999999994,
                  "y1": 1124.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "fishing-mace": {
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "fishing-spear": {
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 100,
                  "y0": 748,
                  "x1": 321,
                  "y1": 861
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 74.00000000000006,
                  "y0": 61.500000000000114,
                  "x1": 381.99999999999994,
                  "y1": 1124.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-broadsword": {
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 100,
                  "y0": 748,
                  "x1": 321,
                  "y1": 861
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 74.00000000000006,
                  "y0": 61.500000000000114,
                  "x1": 381.99999999999994,
                  "y1": 1124.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "harlyao-longsword": {
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 100,
                  "y0": 748,
                  "x1": 321,
                  "y1": 861
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 74.00000000000006,
                  "y0": 61.500000000000114,
                  "x1": 381.99999999999994,
                  "y1": 1124.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "hatchet": {
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "hoe": {
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "kylie": {
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "pick-shovel-pick": {
          "layerOrder": "head-over-haft",
          "animation": "thrust",
          "disallow": true
        },
        "pickshovel-scoop": {
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "disallow": true
        },
        "plains-blade": {
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 100,
                  "y0": 748,
                  "x1": 321,
                  "y1": 861
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 74.00000000000006,
                  "y0": 61.500000000000114,
                  "x1": 381.99999999999994,
                  "y1": 1124.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "porakaneki-greatclub": {
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "war-cleaver": {
          "layerOrder": "haft-over-head",
          "animation": "thrust",
          "bridges": {
            "strokes": [
              {
                "recipe": "recipe-1",
                "box": {
                  "x0": 100,
                  "y0": 748,
                  "x1": 321,
                  "y1": 861
                }
              },
              {
                "recipe": "tanged-head---sleeved-shaft",
                "box": {
                  "x0": 74.00000000000006,
                  "y0": 61.500000000000114,
                  "x1": 381.99999999999994,
                  "y1": 1124.4999999999995
                }
              }
            ],
            "outline": 10,
            "light": [
              0,
              -1
            ],
            "shade": 0.3,
            "seed": 1
          }
        },
        "warhammer": {
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "work-hammer": {
          "layerOrder": "head-over-haft",
          "animation": "thrust"
        },
        "bshuakauitl": {
          "layerOrder": "head-over-haft",
          "animation": "thrust"
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
          "layerOrder": "haft-over-head",
          "disallow": true
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
  },
  "recipes": {
    "recipe-1": {
      "box": {
        "x0": 166.5,
        "y0": 915.5,
        "x1": 223,
        "y1": 1026
      },
      "ops": [
        {
          "junction": "band",
          "x": 193,
          "y": 987.5,
          "rotation": 0,
          "scale": 0.6
        },
        {
          "junction": "band",
          "x": 192.5,
          "y": 945.5,
          "rotation": 0,
          "scale": 0.6
        },
        {
          "r": 16,
          "smudge": true,
          "points": [
            [
              191,
              945
            ],
            [
              190,
              945
            ],
            [
              188.5,
              944.5
            ],
            [
              187,
              944
            ],
            [
              185.5,
              944
            ],
            [
              184.5,
              944
            ],
            [
              184,
              945
            ],
            [
              185.5,
              950
            ],
            [
              189,
              959.5
            ],
            [
              192.5,
              971
            ],
            [
              193,
              974.5
            ],
            [
              193.5,
              978
            ],
            [
              194.5,
              983
            ],
            [
              194.5,
              984
            ]
          ]
        },
        {
          "r": 16,
          "smudge": true,
          "points": [
            [
              210.5,
              943
            ],
            [
              210,
              944
            ],
            [
              209.5,
              945
            ],
            [
              209.5,
              946.5
            ],
            [
              209,
              948.5
            ],
            [
              209,
              954
            ],
            [
              209,
              962
            ],
            [
              209.5,
              966.5
            ],
            [
              210.5,
              969.5
            ],
            [
              211,
              971
            ]
          ]
        },
        {
          "r": 16,
          "smudge": true,
          "points": [
            [
              190,
              964.5
            ],
            [
              188.5,
              965.5
            ],
            [
              187.5,
              965.5
            ],
            [
              186,
              966
            ],
            [
              185,
              966
            ],
            [
              183.5,
              966.5
            ],
            [
              182.5,
              967
            ],
            [
              181.5,
              967
            ],
            [
              181.5,
              966
            ],
            [
              181.5,
              967
            ],
            [
              181.5,
              969
            ],
            [
              181.5,
              970.5
            ],
            [
              182,
              972
            ],
            [
              182,
              972.5
            ]
          ]
        },
        {
          "r": 16,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1452641045,
          "smoothing": 2,
          "speck": 40,
          "points": [
            [
              191,
              960.5
            ],
            [
              191,
              959.5
            ],
            [
              190,
              958.5
            ],
            [
              189,
              958
            ],
            [
              188,
              957.5
            ],
            [
              187,
              957
            ],
            [
              186,
              957.5
            ],
            [
              186,
              958.5
            ],
            [
              186,
              960
            ],
            [
              186.5,
              962.5
            ],
            [
              188,
              967
            ],
            [
              192.5,
              973.5
            ],
            [
              198,
              978
            ],
            [
              200,
              979
            ]
          ]
        },
        {
          "r": 16,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1022056883,
          "smoothing": 2,
          "speck": 40,
          "points": [
            [
              200.5,
              946
            ],
            [
              199.5,
              945.5
            ],
            [
              198.5,
              946
            ],
            [
              198,
              947
            ],
            [
              197.5,
              948.5
            ],
            [
              197.5,
              950.5
            ],
            [
              197.5,
              953
            ],
            [
              197.5,
              956
            ],
            [
              197.5,
              958.5
            ],
            [
              198,
              961
            ],
            [
              198.5,
              963.5
            ],
            [
              199,
              965
            ],
            [
              199.5,
              966.5
            ],
            [
              200,
              967.5
            ]
          ]
        },
        {
          "r": 16,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1635777470,
          "smoothing": 2,
          "speck": 40,
          "points": [
            [
              196.5,
              948
            ],
            [
              195.5,
              947.5
            ],
            [
              193.5,
              946.5
            ],
            [
              192.5,
              946.5
            ],
            [
              191,
              946
            ],
            [
              190,
              946.5
            ],
            [
              190,
              948.5
            ],
            [
              190.5,
              950.5
            ],
            [
              190.5,
              952
            ],
            [
              191,
              955
            ],
            [
              192,
              962
            ],
            [
              193,
              968
            ],
            [
              193,
              972
            ],
            [
              193.5,
              976.5
            ],
            [
              195,
              981.5
            ],
            [
              196.5,
              986.5
            ],
            [
              197.5,
              991.5
            ],
            [
              199,
              995
            ],
            [
              200.5,
              998
            ],
            [
              201.5,
              997.5
            ]
          ]
        },
        {
          "r": 16,
          "tool": "clean",
          "strength": 0.5,
          "seed": 110972221,
          "smoothing": 2,
          "speck": 40,
          "points": [
            [
              199.5,
              937
            ],
            [
              198.5,
              938
            ],
            [
              197.5,
              940
            ],
            [
              197.5,
              941.5
            ],
            [
              197.5,
              943
            ],
            [
              197,
              949
            ],
            [
              196.5,
              957
            ],
            [
              196.5,
              962.5
            ],
            [
              197.5,
              967
            ],
            [
              199.5,
              971
            ],
            [
              203,
              975
            ],
            [
              207,
              979
            ],
            [
              212,
              983
            ],
            [
              216,
              988
            ],
            [
              218,
              990.5
            ]
          ]
        },
        {
          "r": 16,
          "tool": "clean",
          "strength": 0.5,
          "seed": 2119810200,
          "smoothing": 2,
          "speck": 40,
          "points": [
            [
              199,
              905
            ],
            [
              198,
              905
            ],
            [
              198.5,
              906
            ],
            [
              200,
              910.5
            ],
            [
              202.5,
              922.5
            ],
            [
              203.5,
              937.5
            ],
            [
              203,
              952
            ],
            [
              203,
              967
            ],
            [
              204,
              979.5
            ],
            [
              206.5,
              991
            ],
            [
              210.5,
              1002
            ],
            [
              215.5,
              1013
            ],
            [
              220,
              1025.5
            ],
            [
              224.5,
              1039
            ],
            [
              229,
              1054.5
            ],
            [
              231.5,
              1063
            ]
          ]
        }
      ],
      "anchor": {
        "rank": 1,
        "count": 2,
        "mount": {
          "x": 189,
          "y": 963,
          "ax": 1,
          "ay": 0,
          "len": 40
        }
      }
    },
    "tanged-head---sleeved-shaft": {
      "box": {
        "x0": 41,
        "y0": 73.5,
        "x1": 349,
        "y1": 1136.5
      },
      "ops": [
        {
          "junction": "band",
          "x": 189.81415929203538,
          "y": 283.10633484162895,
          "rotation": 0,
          "scale": 0.6423750129868807
        },
        {
          "junction": "band",
          "x": 189.26106194690266,
          "y": 239.58597285067873,
          "rotation": 0,
          "scale": 0.6423750129868807
        },
        {
          "r": 17.13000034631682,
          "smudge": true,
          "points": [
            [
              187.60176991150442,
              239.0678733031674
            ],
            [
              186.49557522123894,
              239.0678733031674
            ],
            [
              184.8362831858407,
              238.5497737556561
            ],
            [
              183.17699115044246,
              238.0316742081448
            ],
            [
              181.51769911504425,
              238.0316742081448
            ],
            [
              180.41150442477874,
              238.0316742081448
            ],
            [
              179.858407079646,
              239.0678733031674
            ],
            [
              181.51769911504425,
              244.24886877828055
            ],
            [
              185.38938053097345,
              254.09276018099547
            ],
            [
              189.26106194690266,
              266.00904977375563
            ],
            [
              189.81415929203538,
              269.63574660633486
            ],
            [
              190.36725663716814,
              273.26244343891403
            ],
            [
              191.47345132743362,
              278.4434389140271
            ],
            [
              191.47345132743362,
              279.4796380090498
            ]
          ]
        },
        {
          "r": 17.13000034631682,
          "smudge": true,
          "points": [
            [
              209.17256637168143,
              236.99547511312215
            ],
            [
              208.6194690265487,
              238.0316742081448
            ],
            [
              208.06637168141594,
              239.0678733031674
            ],
            [
              208.06637168141594,
              240.62217194570135
            ],
            [
              207.5132743362832,
              242.6945701357466
            ],
            [
              207.5132743362832,
              248.39366515837105
            ],
            [
              207.5132743362832,
              256.68325791855204
            ],
            [
              208.06637168141594,
              261.34615384615387
            ],
            [
              209.17256637168143,
              264.4547511312217
            ],
            [
              209.72566371681418,
              266.00904977375563
            ]
          ]
        },
        {
          "r": 17.13000034631682,
          "smudge": true,
          "points": [
            [
              186.49557522123894,
              259.2737556561086
            ],
            [
              184.8362831858407,
              260.3099547511312
            ],
            [
              183.73008849557522,
              260.3099547511312
            ],
            [
              182.07079646017698,
              260.82805429864254
            ],
            [
              180.9646017699115,
              260.82805429864254
            ],
            [
              179.30530973451326,
              261.34615384615387
            ],
            [
              178.19911504424778,
              261.86425339366514
            ],
            [
              177.0929203539823,
              261.86425339366514
            ],
            [
              177.0929203539823,
              260.82805429864254
            ],
            [
              177.0929203539823,
              261.86425339366514
            ],
            [
              177.0929203539823,
              263.9366515837104
            ],
            [
              177.0929203539823,
              265.49095022624437
            ],
            [
              177.64601769911502,
              267.0452488687783
            ],
            [
              177.64601769911502,
              267.5633484162896
            ]
          ]
        },
        {
          "r": 17.13000034631682,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1452641045,
          "smoothing": 2.1412500432896024,
          "speck": 45.849517478877246,
          "points": [
            [
              187.60176991150442,
              255.1289592760181
            ],
            [
              187.60176991150442,
              254.09276018099547
            ],
            [
              186.49557522123894,
              253.05656108597285
            ],
            [
              185.38938053097345,
              252.53846153846155
            ],
            [
              184.28318584070797,
              252.02036199095022
            ],
            [
              183.17699115044246,
              251.50226244343892
            ],
            [
              182.07079646017698,
              252.02036199095022
            ],
            [
              182.07079646017698,
              253.05656108597285
            ],
            [
              182.07079646017698,
              254.6108597285068
            ],
            [
              182.62389380530973,
              257.20135746606337
            ],
            [
              184.28318584070797,
              261.86425339366514
            ],
            [
              189.26106194690266,
              268.5995475113122
            ],
            [
              195.34513274336283,
              273.26244343891403
            ],
            [
              197.55752212389382,
              274.29864253393663
            ]
          ]
        },
        {
          "r": 17.13000034631682,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1022056883,
          "smoothing": 2.1412500432896024,
          "speck": 45.849517478877246,
          "points": [
            [
              198.11061946902655,
              240.10407239819006
            ],
            [
              197.00442477876106,
              239.58597285067873
            ],
            [
              195.89823008849558,
              240.10407239819006
            ],
            [
              195.34513274336283,
              241.14027149321268
            ],
            [
              194.7920353982301,
              242.6945701357466
            ],
            [
              194.7920353982301,
              244.76696832579185
            ],
            [
              194.7920353982301,
              247.35746606334843
            ],
            [
              194.7920353982301,
              250.4660633484163
            ],
            [
              194.7920353982301,
              253.05656108597285
            ],
            [
              195.34513274336283,
              255.64705882352942
            ],
            [
              195.89823008849558,
              258.23755656108597
            ],
            [
              196.45132743362834,
              259.7918552036199
            ],
            [
              197.00442477876106,
              261.34615384615387
            ],
            [
              197.55752212389382,
              262.38235294117646
            ]
          ]
        },
        {
          "r": 17.13000034631682,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1635777470,
          "smoothing": 2.1412500432896024,
          "speck": 45.849517478877246,
          "points": [
            [
              193.68584070796462,
              242.1764705882353
            ],
            [
              192.5796460176991,
              241.65837104072398
            ],
            [
              190.36725663716814,
              240.62217194570135
            ],
            [
              189.26106194690266,
              240.62217194570135
            ],
            [
              187.60176991150442,
              240.10407239819006
            ],
            [
              186.49557522123894,
              240.62217194570135
            ],
            [
              186.49557522123894,
              242.6945701357466
            ],
            [
              187.04867256637166,
              244.76696832579185
            ],
            [
              187.04867256637166,
              246.3212669683258
            ],
            [
              187.60176991150442,
              249.42986425339367
            ],
            [
              188.7079646017699,
              256.68325791855204
            ],
            [
              189.81415929203538,
              262.9004524886878
            ],
            [
              189.81415929203538,
              267.0452488687783
            ],
            [
              190.36725663716814,
              271.7081447963801
            ],
            [
              192.02654867256638,
              276.8891402714932
            ],
            [
              193.68584070796462,
              282.07013574660635
            ],
            [
              194.7920353982301,
              287.25113122171945
            ],
            [
              196.45132743362834,
              290.8778280542987
            ],
            [
              198.11061946902655,
              293.9864253393665
            ],
            [
              199.21681415929203,
              293.4683257918552
            ]
          ]
        },
        {
          "r": 17.13000034631682,
          "tool": "clean",
          "strength": 0.5,
          "seed": 110972221,
          "smoothing": 2.1412500432896024,
          "speck": 45.849517478877246,
          "points": [
            [
              197.00442477876106,
              230.7782805429864
            ],
            [
              195.89823008849558,
              231.81447963800906
            ],
            [
              194.7920353982301,
              233.8868778280543
            ],
            [
              194.7920353982301,
              235.44117647058823
            ],
            [
              194.7920353982301,
              236.99547511312215
            ],
            [
              194.23893805309734,
              243.21266968325793
            ],
            [
              193.68584070796462,
              251.50226244343892
            ],
            [
              193.68584070796462,
              257.20135746606337
            ],
            [
              194.7920353982301,
              261.86425339366514
            ],
            [
              197.00442477876106,
              266.00904977375563
            ],
            [
              200.87610619469027,
              270.15384615384613
            ],
            [
              205.30088495575222,
              274.29864253393663
            ],
            [
              210.83185840707966,
              278.4434389140271
            ],
            [
              215.25663716814162,
              283.6244343891403
            ],
            [
              217.4690265486726,
              286.21493212669685
            ]
          ]
        },
        {
          "r": 17.13000034631682,
          "tool": "clean",
          "strength": 0.5,
          "seed": 2119810200,
          "smoothing": 2.1412500432896024,
          "speck": 45.849517478877246,
          "points": [
            [
              196.45132743362834,
              197.61990950226243
            ],
            [
              195.34513274336283,
              197.61990950226243
            ],
            [
              195.89823008849558,
              198.65610859728505
            ],
            [
              197.55752212389382,
              203.31900452488688
            ],
            [
              200.32300884955754,
              215.75339366515837
            ],
            [
              201.42920353982302,
              231.29638009049773
            ],
            [
              200.87610619469027,
              246.3212669683258
            ],
            [
              200.87610619469027,
              261.86425339366514
            ],
            [
              201.98230088495575,
              274.81674208144796
            ],
            [
              204.74778761061947,
              286.7330316742081
            ],
            [
              209.17256637168143,
              298.131221719457
            ],
            [
              214.70353982300887,
              309.52941176470586
            ],
            [
              219.68141592920358,
              322.4819004524887
            ],
            [
              224.65929203539827,
              336.47058823529414
            ],
            [
              229.63716814159295,
              352.5316742081448
            ],
            [
              232.40265486725667,
              361.3393665158371
            ]
          ]
        },
        {
          "junction": "band",
          "x": 190.69026548672565,
          "y": 1009.7420814479638,
          "rotation": 0,
          "scale": 0.6360378193442962
        },
        {
          "junction": "band",
          "x": 190.10176991150442,
          "y": 969.6425339366516,
          "rotation": 0,
          "scale": 0.6360378193442962
        },
        {
          "r": 16.961008515847897,
          "smudge": true,
          "points": [
            [
              188.3362831858407,
              969.1651583710408
            ],
            [
              187.15929203539824,
              969.1651583710408
            ],
            [
              185.39380530973452,
              968.6877828054298
            ],
            [
              183.6283185840708,
              968.210407239819
            ],
            [
              181.86283185840708,
              968.210407239819
            ],
            [
              180.6858407079646,
              968.210407239819
            ],
            [
              180.09734513274336,
              969.1651583710408
            ],
            [
              181.86283185840708,
              973.9389140271493
            ],
            [
              185.98230088495575,
              983.0090497737557
            ],
            [
              190.10176991150442,
              993.9886877828054
            ],
            [
              190.69026548672565,
              997.3303167420814
            ],
            [
              191.2787610619469,
              1000.6719457013575
            ],
            [
              192.45575221238937,
              1005.4457013574661
            ],
            [
              192.45575221238937,
              1006.4004524886877
            ]
          ]
        },
        {
          "r": 16.961008515847897,
          "smudge": true,
          "points": [
            [
              211.28761061946904,
              967.2556561085972
            ],
            [
              210.6991150442478,
              968.210407239819
            ],
            [
              210.11061946902657,
              969.1651583710408
            ],
            [
              210.11061946902657,
              970.5972850678733
            ],
            [
              209.52212389380531,
              972.5067873303167
            ],
            [
              209.52212389380531,
              977.7579185520362
            ],
            [
              209.52212389380531,
              985.39592760181
            ],
            [
              210.11061946902657,
              989.6923076923077
            ],
            [
              211.28761061946904,
              992.5565610859728
            ],
            [
              211.8761061946903,
              993.9886877828054
            ]
          ]
        },
        {
          "r": 16.961008515847897,
          "smudge": true,
          "points": [
            [
              187.15929203539824,
              987.7828054298642
            ],
            [
              185.39380530973452,
              988.737556561086
            ],
            [
              184.21681415929203,
              988.737556561086
            ],
            [
              182.4513274336283,
              989.2149321266968
            ],
            [
              181.27433628318585,
              989.2149321266968
            ],
            [
              179.50884955752213,
              989.6923076923077
            ],
            [
              178.33185840707964,
              990.1696832579186
            ],
            [
              177.15486725663715,
              990.1696832579186
            ],
            [
              177.15486725663715,
              989.2149321266968
            ],
            [
              177.15486725663715,
              990.1696832579186
            ],
            [
              177.15486725663715,
              992.079185520362
            ],
            [
              177.15486725663715,
              993.5113122171946
            ],
            [
              177.7433628318584,
              994.9434389140272
            ],
            [
              177.7433628318584,
              995.420814479638
            ]
          ]
        },
        {
          "r": 16.961008515847897,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1452641045,
          "smoothing": 2.120126064480987,
          "speck": 44.94934529291639,
          "points": [
            [
              188.3362831858407,
              983.9638009049773
            ],
            [
              188.3362831858407,
              983.0090497737557
            ],
            [
              187.15929203539824,
              982.0542986425339
            ],
            [
              185.98230088495575,
              981.5769230769231
            ],
            [
              184.80530973451326,
              981.0995475113123
            ],
            [
              183.6283185840708,
              980.6221719457013
            ],
            [
              182.4513274336283,
              981.0995475113123
            ],
            [
              182.4513274336283,
              982.0542986425339
            ],
            [
              182.4513274336283,
              983.4864253393665
            ],
            [
              183.03982300884954,
              985.8733031674208
            ],
            [
              184.80530973451326,
              990.1696832579186
            ],
            [
              190.10176991150442,
              996.3755656108598
            ],
            [
              196.57522123893807,
              1000.6719457013575
            ],
            [
              198.92920353982302,
              1001.6266968325792
            ]
          ]
        },
        {
          "r": 16.961008515847897,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1022056883,
          "smoothing": 2.120126064480987,
          "speck": 44.94934529291639,
          "points": [
            [
              199.51769911504425,
              970.1199095022624
            ],
            [
              198.34070796460176,
              969.6425339366516
            ],
            [
              197.1637168141593,
              970.1199095022624
            ],
            [
              196.57522123893807,
              971.0746606334842
            ],
            [
              195.9867256637168,
              972.5067873303167
            ],
            [
              195.9867256637168,
              974.4162895927602
            ],
            [
              195.9867256637168,
              976.8031674208145
            ],
            [
              195.9867256637168,
              979.6674208144797
            ],
            [
              195.9867256637168,
              982.0542986425339
            ],
            [
              196.57522123893807,
              984.4411764705883
            ],
            [
              197.1637168141593,
              986.8280542986425
            ],
            [
              197.75221238938053,
              988.2601809954751
            ],
            [
              198.34070796460176,
              989.6923076923077
            ],
            [
              198.92920353982302,
              990.6470588235294
            ]
          ]
        },
        {
          "r": 16.961008515847897,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1635777470,
          "smoothing": 2.120126064480987,
          "speck": 44.94934529291639,
          "points": [
            [
              194.80973451327435,
              972.0294117647059
            ],
            [
              193.63274336283186,
              971.552036199095
            ],
            [
              191.2787610619469,
              970.5972850678733
            ],
            [
              190.10176991150442,
              970.5972850678733
            ],
            [
              188.3362831858407,
              970.1199095022624
            ],
            [
              187.15929203539824,
              970.5972850678733
            ],
            [
              187.15929203539824,
              972.5067873303167
            ],
            [
              187.74778761061947,
              974.4162895927602
            ],
            [
              187.74778761061947,
              975.8484162895927
            ],
            [
              188.3362831858407,
              978.7126696832579
            ],
            [
              189.5132743362832,
              985.39592760181
            ],
            [
              190.69026548672565,
              991.1244343891402
            ],
            [
              190.69026548672565,
              994.9434389140272
            ],
            [
              191.2787610619469,
              999.2398190045249
            ],
            [
              193.04424778761063,
              1004.0135746606335
            ],
            [
              194.80973451327435,
              1008.7873303167421
            ],
            [
              195.9867256637168,
              1013.5610859728507
            ],
            [
              197.75221238938053,
              1016.9027149321267
            ],
            [
              199.51769911504425,
              1019.7669683257918
            ],
            [
              200.69469026548674,
              1019.289592760181
            ]
          ]
        },
        {
          "r": 16.961008515847897,
          "tool": "clean",
          "strength": 0.5,
          "seed": 110972221,
          "smoothing": 2.120126064480987,
          "speck": 44.94934529291639,
          "points": [
            [
              198.34070796460176,
              961.527149321267
            ],
            [
              197.1637168141593,
              962.4819004524887
            ],
            [
              195.9867256637168,
              964.3914027149322
            ],
            [
              195.9867256637168,
              965.8235294117648
            ],
            [
              195.9867256637168,
              967.2556561085972
            ],
            [
              195.39823008849558,
              972.9841628959276
            ],
            [
              194.80973451327435,
              980.6221719457013
            ],
            [
              194.80973451327435,
              985.8733031674208
            ],
            [
              195.9867256637168,
              990.1696832579186
            ],
            [
              198.34070796460176,
              993.9886877828054
            ],
            [
              202.46017699115046,
              997.8076923076923
            ],
            [
              207.16814159292036,
              1001.6266968325792
            ],
            [
              213.05309734513276,
              1005.4457013574661
            ],
            [
              217.7610619469027,
              1010.2194570135747
            ],
            [
              220.11504424778764,
              1012.606334841629
            ]
          ]
        },
        {
          "r": 16.961008515847897,
          "tool": "clean",
          "strength": 0.5,
          "seed": 2119810200,
          "smoothing": 2.120126064480987,
          "speck": 44.94934529291639,
          "points": [
            [
              197.75221238938053,
              930.9751131221719
            ],
            [
              196.57522123893807,
              930.9751131221719
            ],
            [
              197.1637168141593,
              931.9298642533937
            ],
            [
              198.92920353982302,
              936.2262443438914
            ],
            [
              201.8716814159292,
              947.683257918552
            ],
            [
              203.0486725663717,
              962.0045248868778
            ],
            [
              202.46017699115046,
              975.8484162895927
            ],
            [
              202.46017699115046,
              990.1696832579186
            ],
            [
              203.63716814159292,
              1002.10407239819
            ],
            [
              206.57964601769913,
              1013.0837104072398
            ],
            [
              211.28761061946904,
              1023.5859728506788
            ],
            [
              217.17256637168143,
              1034.0882352941176
            ],
            [
              222.4690265486726,
              1046.0226244343892
            ],
            [
              227.76548672566375,
              1058.9117647058824
            ],
            [
              233.0619469026549,
              1073.710407239819
            ],
            [
              236.0044247787611,
              1081.8257918552035
            ]
          ]
        }
      ],
      "anchor": {
        "rank": 0,
        "count": 2,
        "mount": {
          "x": 174,
          "y": 291,
          "ax": -0.7937940037885707,
          "ay": 0.6081867143807981,
          "len": 40.000000000000014
        }
      }
    },
    "recipe-3": {
      "box": {
        "x0": 55,
        "y0": 129,
        "x1": 257.5,
        "y1": 1084.5
      },
      "ops": [
        {
          "junction": "band",
          "x": 188.31415929203538,
          "y": 289.7894139781971,
          "rotation": 0,
          "scale": 0.6333988166925798
        },
        {
          "junction": "band",
          "x": 187.76106194690266,
          "y": 247.47681367937582,
          "rotation": 0,
          "scale": 0.6333988166925798
        },
        {
          "r": 16.89063511180213,
          "smudge": true,
          "points": [
            [
              186.10176991150442,
              246.973092247247
            ],
            [
              184.99557522123894,
              246.973092247247
            ],
            [
              183.3362831858407,
              246.46937081511817
            ],
            [
              181.67699115044246,
              245.96564938298934
            ],
            [
              180.01769911504425,
              245.96564938298934
            ],
            [
              178.91150442477874,
              245.96564938298934
            ],
            [
              178.358407079646,
              246.973092247247
            ],
            [
              180.01769911504425,
              252.01030656853527
            ],
            [
              183.88938053097345,
              261.58101377898294
            ],
            [
              187.76106194690266,
              273.16660671794585
            ],
            [
              188.31415929203538,
              276.6926567428477
            ],
            [
              188.86725663716814,
              280.21870676774944
            ],
            [
              189.97345132743362,
              285.25592108903766
            ],
            [
              189.97345132743362,
              286.26336395329537
            ]
          ]
        },
        {
          "r": 16.89063511180213,
          "smudge": true,
          "points": [
            [
              207.67256637168143,
              244.95820651873169
            ],
            [
              207.1194690265487,
              245.96564938298934
            ],
            [
              206.56637168141594,
              246.973092247247
            ],
            [
              206.56637168141594,
              248.48425654363342
            ],
            [
              206.0132743362832,
              250.4991422721488
            ],
            [
              206.0132743362832,
              256.04007802556583
            ],
            [
              206.0132743362832,
              264.0996209396271
            ],
            [
              206.56637168141594,
              268.6331138287865
            ],
            [
              207.67256637168143,
              271.6554424215594
            ],
            [
              208.22566371681418,
              273.16660671794585
            ]
          ]
        },
        {
          "r": 16.89063511180213,
          "smudge": true,
          "points": [
            [
              184.99557522123894,
              266.6182281002712
            ],
            [
              183.3362831858407,
              267.6256709645288
            ],
            [
              182.23008849557522,
              267.6256709645288
            ],
            [
              180.57079646017698,
              268.12939239665764
            ],
            [
              179.4646017699115,
              268.12939239665764
            ],
            [
              177.80530973451326,
              268.6331138287865
            ],
            [
              176.69911504424778,
              269.1368352609153
            ],
            [
              175.5929203539823,
              269.1368352609153
            ],
            [
              175.5929203539823,
              268.12939239665764
            ],
            [
              175.5929203539823,
              269.1368352609153
            ],
            [
              175.5929203539823,
              271.1517209894306
            ],
            [
              175.5929203539823,
              272.6628852858171
            ],
            [
              176.14601769911502,
              274.17404958220357
            ],
            [
              176.14601769911502,
              274.6777710143324
            ]
          ]
        },
        {
          "r": 16.89063511180213,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1452641045,
          "smoothing": 2.1113293889752662,
          "speck": 44.5771178875067,
          "points": [
            [
              186.10176991150442,
              262.5884566432406
            ],
            [
              186.10176991150442,
              261.58101377898294
            ],
            [
              184.99557522123894,
              260.5735709147252
            ],
            [
              183.88938053097345,
              260.06984948259645
            ],
            [
              182.78318584070797,
              259.5661280504676
            ],
            [
              181.67699115044246,
              259.0624066183388
            ],
            [
              180.57079646017698,
              259.5661280504676
            ],
            [
              180.57079646017698,
              260.5735709147252
            ],
            [
              180.57079646017698,
              262.08473521111176
            ],
            [
              181.12389380530973,
              264.6033423717559
            ],
            [
              182.78318584070797,
              269.1368352609153
            ],
            [
              187.76106194690266,
              275.68521387859
            ],
            [
              193.84513274336283,
              280.21870676774944
            ],
            [
              196.05752212389382,
              281.2261496320071
            ]
          ]
        },
        {
          "r": 16.89063511180213,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1022056883,
          "smoothing": 2.1113293889752662,
          "speck": 44.5771178875067,
          "points": [
            [
              196.61061946902655,
              247.98053511150465
            ],
            [
              195.50442477876106,
              247.47681367937582
            ],
            [
              194.39823008849558,
              247.98053511150465
            ],
            [
              193.84513274336283,
              248.9879779757623
            ],
            [
              193.2920353982301,
              250.4991422721488
            ],
            [
              193.2920353982301,
              252.51402800066404
            ],
            [
              193.2920353982301,
              255.03263516130818
            ],
            [
              193.2920353982301,
              258.05496375408114
            ],
            [
              193.2920353982301,
              260.5735709147252
            ],
            [
              193.84513274336283,
              263.09217807536936
            ],
            [
              194.39823008849558,
              265.6107852360135
            ],
            [
              194.95132743362834,
              267.1219495324
            ],
            [
              195.50442477876106,
              268.6331138287865
            ],
            [
              196.05752212389382,
              269.6405566930441
            ]
          ]
        },
        {
          "r": 16.89063511180213,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1635777470,
          "smoothing": 2.1113293889752662,
          "speck": 44.5771178875067,
          "points": [
            [
              192.18584070796462,
              249.99542084001996
            ],
            [
              191.0796460176991,
              249.49169940789113
            ],
            [
              188.86725663716814,
              248.48425654363342
            ],
            [
              187.76106194690266,
              248.48425654363342
            ],
            [
              186.10176991150442,
              247.98053511150465
            ],
            [
              184.99557522123894,
              248.48425654363342
            ],
            [
              184.99557522123894,
              250.4991422721488
            ],
            [
              185.54867256637166,
              252.51402800066404
            ],
            [
              185.54867256637166,
              254.02519229705052
            ],
            [
              186.10176991150442,
              257.04752088982355
            ],
            [
              187.2079646017699,
              264.0996209396271
            ],
            [
              188.31415929203538,
              270.14427812517295
            ],
            [
              188.31415929203538,
              274.17404958220357
            ],
            [
              188.86725663716814,
              278.707542471363
            ],
            [
              190.52654867256638,
              283.74475679265123
            ],
            [
              192.18584070796462,
              288.7819711139395
            ],
            [
              193.2920353982301,
              293.8191854352277
            ],
            [
              194.95132743362834,
              297.3452354601295
            ],
            [
              196.61061946902655,
              300.3675640529025
            ],
            [
              197.71681415929203,
              299.8638426207736
            ]
          ]
        },
        {
          "r": 16.89063511180213,
          "tool": "clean",
          "strength": 0.5,
          "seed": 110972221,
          "smoothing": 2.1113293889752662,
          "speck": 44.5771178875067,
          "points": [
            [
              195.50442477876106,
              238.91354933318576
            ],
            [
              194.39823008849558,
              239.92099219744347
            ],
            [
              193.2920353982301,
              241.93587792595872
            ],
            [
              193.2920353982301,
              243.4470422223452
            ],
            [
              193.2920353982301,
              244.95820651873169
            ],
            [
              192.73893805309734,
              251.00286370427756
            ],
            [
              192.18584070796462,
              259.0624066183388
            ],
            [
              192.18584070796462,
              264.6033423717559
            ],
            [
              193.2920353982301,
              269.1368352609153
            ],
            [
              195.50442477876106,
              273.16660671794585
            ],
            [
              199.37610619469027,
              277.1963781749765
            ],
            [
              203.80088495575222,
              281.2261496320071
            ],
            [
              209.33185840707966,
              285.25592108903766
            ],
            [
              213.75663716814162,
              290.29313541032593
            ],
            [
              215.9690265486726,
              292.8117425709701
            ]
          ]
        },
        {
          "r": 16.89063511180213,
          "tool": "clean",
          "strength": 0.5,
          "seed": 2119810200,
          "smoothing": 2.1113293889752662,
          "speck": 44.5771178875067,
          "points": [
            [
              194.95132743362834,
              206.67537767694097
            ],
            [
              193.84513274336283,
              206.67537767694097
            ],
            [
              194.39823008849558,
              207.68282054119862
            ],
            [
              196.05752212389382,
              212.216313430358
            ],
            [
              198.82300884955754,
              224.30562780144982
            ],
            [
              199.92920353982302,
              239.41727076531458
            ],
            [
              199.37610619469027,
              254.02519229705052
            ],
            [
              199.37610619469027,
              269.1368352609153
            ],
            [
              200.48230088495575,
              281.7298710641359
            ],
            [
              203.24778761061947,
              293.3154640030989
            ],
            [
              207.67256637168143,
              304.39733550993304
            ],
            [
              213.20353982300887,
              315.4792070167672
            ],
            [
              218.18141592920358,
              328.0722428199878
            ],
            [
              223.15929203539827,
              341.67272148746616
            ],
            [
              228.13716814159295,
              357.2880858834597
            ],
            [
              230.90265486725667,
              365.8513502296497
            ]
          ]
        },
        {
          "junction": "band",
          "x": 189.19026548672565,
          "y": 996.2598223673288,
          "rotation": 0,
          "scale": 0.6271501755200335
        },
        {
          "junction": "band",
          "x": 188.60176991150442,
          "y": 957.2731033147031,
          "rotation": 0,
          "scale": 0.6271501755200335
        },
        {
          "r": 16.724004680534225,
          "smudge": true,
          "points": [
            [
              186.8362831858407,
              956.8089757069338
            ],
            [
              185.65929203539824,
              956.8089757069338
            ],
            [
              183.89380530973452,
              956.3448480991644
            ],
            [
              182.1283185840708,
              955.8807204913951
            ],
            [
              180.36283185840708,
              955.8807204913951
            ],
            [
              179.1858407079646,
              955.8807204913951
            ],
            [
              178.59734513274336,
              956.8089757069338
            ],
            [
              180.36283185840708,
              961.4502517846272
            ],
            [
              184.48230088495575,
              970.268676332245
            ],
            [
              188.60176991150442,
              980.9436113109401
            ],
            [
              189.19026548672565,
              984.1925045653256
            ],
            [
              189.7787610619469,
              987.441397819711
            ],
            [
              190.95575221238937,
              992.0826738974047
            ],
            [
              190.95575221238937,
              993.0109291129434
            ]
          ]
        },
        {
          "r": 16.724004680534225,
          "smudge": true,
          "points": [
            [
              209.78761061946904,
              954.9524652758563
            ],
            [
              209.1991150442478,
              955.8807204913951
            ],
            [
              208.61061946902657,
              956.8089757069338
            ],
            [
              208.61061946902657,
              958.2013585302418
            ],
            [
              208.02212389380531,
              960.0578689613192
            ],
            [
              208.02212389380531,
              965.1632726467822
            ],
            [
              208.02212389380531,
              972.5893143710919
            ],
            [
              208.61061946902657,
              976.7664628410159
            ],
            [
              209.78761061946904,
              979.551228487632
            ],
            [
              210.3761061946903,
              980.9436113109401
            ]
          ]
        },
        {
          "r": 16.724004680534225,
          "smudge": true,
          "points": [
            [
              185.65929203539824,
              974.9099524099386
            ],
            [
              183.89380530973452,
              975.8382076254773
            ],
            [
              182.71681415929203,
              975.8382076254773
            ],
            [
              180.9513274336283,
              976.3023352332466
            ],
            [
              179.77433628318585,
              976.3023352332466
            ],
            [
              178.00884955752213,
              976.7664628410159
            ],
            [
              176.83185840707964,
              977.2305904487853
            ],
            [
              175.65486725663715,
              977.2305904487853
            ],
            [
              175.65486725663715,
              976.3023352332466
            ],
            [
              175.65486725663715,
              977.2305904487853
            ],
            [
              175.65486725663715,
              979.0871008798628
            ],
            [
              175.65486725663715,
              980.4794837031709
            ],
            [
              176.2433628318584,
              981.8718665264789
            ],
            [
              176.2433628318584,
              982.3359941342483
            ]
          ]
        },
        {
          "r": 16.724004680534225,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1452641045,
          "smoothing": 2.090500585066778,
          "speck": 43.70192696164543,
          "points": [
            [
              186.8362831858407,
              971.1969315477837
            ],
            [
              186.8362831858407,
              970.268676332245
            ],
            [
              185.65929203539824,
              969.3404211167062
            ],
            [
              184.48230088495575,
              968.8762935089369
            ],
            [
              183.30530973451326,
              968.4121659011677
            ],
            [
              182.1283185840708,
              967.9480382933982
            ],
            [
              180.9513274336283,
              968.4121659011677
            ],
            [
              180.9513274336283,
              969.3404211167062
            ],
            [
              180.9513274336283,
              970.7328039400144
            ],
            [
              181.53982300884954,
              973.0534419788611
            ],
            [
              183.30530973451326,
              977.2305904487853
            ],
            [
              188.60176991150442,
              983.264249349787
            ],
            [
              195.07522123893807,
              987.441397819711
            ],
            [
              197.42920353982302,
              988.3696530352499
            ]
          ]
        },
        {
          "r": 16.724004680534225,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1022056883,
          "smoothing": 2.090500585066778,
          "speck": 43.70192696164543,
          "points": [
            [
              198.01769911504425,
              957.7372309224725
            ],
            [
              196.84070796460176,
              957.2731033147031
            ],
            [
              195.6637168141593,
              957.7372309224725
            ],
            [
              195.07522123893807,
              958.6654861380111
            ],
            [
              194.4867256637168,
              960.0578689613192
            ],
            [
              194.4867256637168,
              961.9143793923967
            ],
            [
              194.4867256637168,
              964.2350174312435
            ],
            [
              194.4867256637168,
              967.0197830778595
            ],
            [
              194.4867256637168,
              969.3404211167062
            ],
            [
              195.07522123893807,
              971.6610591555532
            ],
            [
              195.6637168141593,
              973.9816971943999
            ],
            [
              196.25221238938053,
              975.3740800177079
            ],
            [
              196.84070796460176,
              976.7664628410159
            ],
            [
              197.42920353982302,
              977.6947180565546
            ]
          ]
        },
        {
          "r": 16.724004680534225,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1635777470,
          "smoothing": 2.090500585066778,
          "speck": 43.70192696164543,
          "points": [
            [
              193.30973451327435,
              959.5937413535498
            ],
            [
              192.13274336283186,
              959.1296137457805
            ],
            [
              189.7787610619469,
              958.2013585302418
            ],
            [
              188.60176991150442,
              958.2013585302418
            ],
            [
              186.8362831858407,
              957.7372309224725
            ],
            [
              185.65929203539824,
              958.2013585302418
            ],
            [
              185.65929203539824,
              960.0578689613192
            ],
            [
              186.24778761061947,
              961.9143793923967
            ],
            [
              186.24778761061947,
              963.3067622157046
            ],
            [
              186.8362831858407,
              966.0915278623208
            ],
            [
              188.0132743362832,
              972.5893143710919
            ],
            [
              189.19026548672565,
              978.158845664324
            ],
            [
              189.19026548672565,
              981.8718665264789
            ],
            [
              189.7787610619469,
              986.049014996403
            ],
            [
              191.54424778761063,
              990.6902910740966
            ],
            [
              193.30973451327435,
              995.3315671517902
            ],
            [
              194.4867256637168,
              999.9728432294837
            ],
            [
              196.25221238938053,
              1003.2217364838692
            ],
            [
              198.01769911504425,
              1006.0065021304853
            ],
            [
              199.19469026548674,
              1005.5423745227159
            ]
          ]
        },
        {
          "r": 16.724004680534225,
          "tool": "clean",
          "strength": 0.5,
          "seed": 110972221,
          "smoothing": 2.090500585066778,
          "speck": 43.70192696164543,
          "points": [
            [
              196.84070796460176,
              949.3829339826241
            ],
            [
              195.6637168141593,
              950.3111891981628
            ],
            [
              194.4867256637168,
              952.1676996292402
            ],
            [
              194.4867256637168,
              953.5600824525484
            ],
            [
              194.4867256637168,
              954.9524652758563
            ],
            [
              193.89823008849558,
              960.5219965690885
            ],
            [
              193.30973451327435,
              967.9480382933982
            ],
            [
              193.30973451327435,
              973.0534419788611
            ],
            [
              194.4867256637168,
              977.2305904487853
            ],
            [
              196.84070796460176,
              980.9436113109401
            ],
            [
              200.96017699115046,
              984.656632173095
            ],
            [
              205.66814159292036,
              988.3696530352499
            ],
            [
              211.55309734513276,
              992.0826738974047
            ],
            [
              216.2610619469027,
              996.7239499750983
            ],
            [
              218.61504424778764,
              999.044588013945
            ]
          ]
        },
        {
          "r": 16.724004680534225,
          "tool": "clean",
          "strength": 0.5,
          "seed": 2119810200,
          "smoothing": 2.090500585066778,
          "speck": 43.70192696164543,
          "points": [
            [
              196.25221238938053,
              919.6787670853854
            ],
            [
              195.07522123893807,
              919.6787670853854
            ],
            [
              195.6637168141593,
              920.6070223009242
            ],
            [
              197.42920353982302,
              924.7841707708483
            ],
            [
              200.3716814159292,
              935.9232333573128
            ],
            [
              201.5486725663717,
              949.8470615903934
            ],
            [
              200.96017699115046,
              963.3067622157046
            ],
            [
              200.96017699115046,
              977.2305904487853
            ],
            [
              202.13716814159292,
              988.8337806430192
            ],
            [
              205.07964601769913,
              999.5087156217144
            ],
            [
              209.78761061946904,
              1009.7195229926401
            ],
            [
              215.67256637168143,
              1019.9303303635659
            ],
            [
              220.9690265486726,
              1031.5335205577999
            ],
            [
              226.26548672566375,
              1044.0649659675723
            ],
            [
              231.5619469026549,
              1058.4529218084224
            ],
            [
              234.5044247787611,
              1066.3430911405012
            ]
          ]
        }
      ],
      "anchor": {
        "rank": 0,
        "count": 2,
        "mount": {
          "x": 174,
          "y": 291,
          "ax": -0.7937940037885707,
          "ay": 0.6081867143807981,
          "len": 40.000000000000014
        }
      }
    },
    "recipe-4": {
      "box": {
        "x0": 96.5,
        "y0": 764.5,
        "x1": 346.5,
        "y1": 1137
      },
      "ops": [
        {
          "junction": "band",
          "x": 190.5731956097,
          "y": 956.2420814479638,
          "rotation": 0,
          "scale": 0.6261519672846841
        },
        {
          "junction": "band",
          "x": 190.0028516837145,
          "y": 916.1425339366516,
          "rotation": 0,
          "scale": 0.6261519672846841
        },
        {
          "r": 16.697385794258242,
          "smudge": true,
          "points": [
            [
              188.29181990575796,
              915.6651583710408
            ],
            [
              187.15113205378694,
              915.6651583710408
            ],
            [
              185.44010027583036,
              915.1877828054298
            ],
            [
              183.7290684978738,
              914.710407239819
            ],
            [
              182.01803671991726,
              914.710407239819
            ],
            [
              180.8773488679462,
              914.710407239819
            ],
            [
              180.30700494196068,
              915.6651583710408
            ],
            [
              182.01803671991726,
              920.4389140271493
            ],
            [
              186.0104442018159,
              929.5090497737557
            ],
            [
              190.0028516837145,
              940.4886877828054
            ],
            [
              190.5731956097,
              943.8303167420814
            ],
            [
              191.14353953568556,
              947.1719457013575
            ],
            [
              192.28422738765659,
              951.9457013574661
            ],
            [
              192.28422738765659,
              952.9004524886877
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "smudge": true,
          "points": [
            [
              210.5352330191932,
              913.7556561085972
            ],
            [
              209.9648890932077,
              914.710407239819
            ],
            [
              209.3945451672222,
              915.6651583710408
            ],
            [
              209.3945451672222,
              917.0972850678733
            ],
            [
              208.82420124123664,
              919.0067873303167
            ],
            [
              208.82420124123664,
              924.2579185520362
            ],
            [
              208.82420124123664,
              931.89592760181
            ],
            [
              209.3945451672222,
              936.1923076923077
            ],
            [
              210.5352330191932,
              939.0565610859728
            ],
            [
              211.10557694517874,
              940.4886877828054
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "smudge": true,
          "points": [
            [
              187.15113205378694,
              934.2828054298642
            ],
            [
              185.44010027583036,
              935.237556561086
            ],
            [
              184.2994124238593,
              935.237556561086
            ],
            [
              182.58838064590276,
              935.7149321266968
            ],
            [
              181.44769279393174,
              935.7149321266968
            ],
            [
              179.7366610159752,
              936.1923076923077
            ],
            [
              178.59597316400414,
              936.6696832579186
            ],
            [
              177.45528531203308,
              936.6696832579186
            ],
            [
              177.45528531203308,
              935.7149321266968
            ],
            [
              177.45528531203308,
              936.6696832579186
            ],
            [
              177.45528531203308,
              938.579185520362
            ],
            [
              177.45528531203308,
              940.0113122171946
            ],
            [
              178.0256292380186,
              941.4434389140272
            ],
            [
              178.0256292380186,
              941.920814479638
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1452641045,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              188.29181990575796,
              930.4638009049773
            ],
            [
              188.29181990575796,
              929.5090497737557
            ],
            [
              187.15113205378694,
              928.5542986425339
            ],
            [
              186.0104442018159,
              928.0769230769231
            ],
            [
              184.86975634984483,
              927.5995475113123
            ],
            [
              183.7290684978738,
              927.1221719457013
            ],
            [
              182.58838064590276,
              927.5995475113123
            ],
            [
              182.58838064590276,
              928.5542986425339
            ],
            [
              182.58838064590276,
              929.9864253393665
            ],
            [
              183.15872457188829,
              932.3733031674208
            ],
            [
              184.86975634984483,
              936.6696832579186
            ],
            [
              190.0028516837145,
              942.8755656108598
            ],
            [
              196.27663486955524,
              947.1719457013575
            ],
            [
              198.5580105734973,
              948.1266968325792
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1022056883,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              199.1283544994828,
              916.6199095022624
            ],
            [
              197.98766664751176,
              916.1425339366516
            ],
            [
              196.84697879554076,
              916.6199095022624
            ],
            [
              196.27663486955524,
              917.5746606334842
            ],
            [
              195.7062909435697,
              919.0067873303167
            ],
            [
              195.7062909435697,
              920.9162895927602
            ],
            [
              195.7062909435697,
              923.3031674208145
            ],
            [
              195.7062909435697,
              926.1674208144797
            ],
            [
              195.7062909435697,
              928.5542986425339
            ],
            [
              196.27663486955524,
              930.9411764705883
            ],
            [
              196.84697879554076,
              933.3280542986425
            ],
            [
              197.41732272152626,
              934.7601809954751
            ],
            [
              197.98766664751176,
              936.1923076923077
            ],
            [
              198.5580105734973,
              937.1470588235294
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1635777470,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              194.5656030915987,
              918.5294117647059
            ],
            [
              193.42491523962764,
              918.052036199095
            ],
            [
              191.14353953568556,
              917.0972850678733
            ],
            [
              190.0028516837145,
              917.0972850678733
            ],
            [
              188.29181990575796,
              916.6199095022624
            ],
            [
              187.15113205378694,
              917.0972850678733
            ],
            [
              187.15113205378694,
              919.0067873303167
            ],
            [
              187.72147597977244,
              920.9162895927602
            ],
            [
              187.72147597977244,
              922.3484162895927
            ],
            [
              188.29181990575796,
              925.2126696832579
            ],
            [
              189.432507757729,
              931.89592760181
            ],
            [
              190.5731956097,
              937.6244343891402
            ],
            [
              190.5731956097,
              941.4434389140272
            ],
            [
              191.14353953568556,
              945.7398190045249
            ],
            [
              192.8545713136421,
              950.5135746606335
            ],
            [
              194.5656030915987,
              955.2873303167421
            ],
            [
              195.7062909435697,
              960.0610859728507
            ],
            [
              197.41732272152626,
              963.4027149321267
            ],
            [
              199.1283544994828,
              966.2669683257918
            ],
            [
              200.26904235145386,
              965.789592760181
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 110972221,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              197.98766664751176,
              908.027149321267
            ],
            [
              196.84697879554076,
              908.9819004524887
            ],
            [
              195.7062909435697,
              910.8914027149322
            ],
            [
              195.7062909435697,
              912.3235294117648
            ],
            [
              195.7062909435697,
              913.7556561085972
            ],
            [
              195.1359470175842,
              919.4841628959276
            ],
            [
              194.5656030915987,
              927.1221719457013
            ],
            [
              194.5656030915987,
              932.3733031674208
            ],
            [
              195.7062909435697,
              936.6696832579186
            ],
            [
              197.98766664751176,
              940.4886877828054
            ],
            [
              201.98007412941044,
              944.3076923076923
            ],
            [
              206.54282553729456,
              948.1266968325792
            ],
            [
              212.24626479714976,
              951.9457013574661
            ],
            [
              216.80901620503394,
              956.7194570135747
            ],
            [
              219.09039190897602,
              959.106334841629
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 2119810200,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              197.41732272152626,
              877.4751131221719
            ],
            [
              196.27663486955524,
              877.4751131221719
            ],
            [
              196.84697879554076,
              878.4298642533937
            ],
            [
              198.5580105734973,
              882.7262443438914
            ],
            [
              201.40973020342489,
              894.183257918552
            ],
            [
              202.55041805539594,
              908.5045248868778
            ],
            [
              201.98007412941044,
              922.3484162895927
            ],
            [
              201.98007412941044,
              936.6696832579186
            ],
            [
              203.12076198138146,
              948.60407239819
            ],
            [
              205.97248161130906,
              959.5837104072398
            ],
            [
              210.5352330191932,
              970.0859728506788
            ],
            [
              216.2386722790484,
              980.5882352941176
            ],
            [
              221.37176761291806,
              992.5226244343892
            ],
            [
              226.50486294678774,
              1005.4117647058824
            ],
            [
              231.63795828065744,
              1020.210407239819
            ],
            [
              234.48967791058502,
              1028.3257918552035
            ]
          ]
        }
      ],
      "anchor": {
        "rank": 1,
        "count": 2,
        "mount": {
          "x": 206,
          "y": 954,
          "ax": 0.7879955955780737,
          "ay": -0.615680876225303,
          "len": 40.000000000000036
        }
      }
    },
    "recipe-5": {
      "box": {
        "x0": 63.5,
        "y0": -64,
        "x1": 307.5,
        "y1": 1250
      },
      "ops": [
        {
          "junction": "band",
          "x": 186.4268043903,
          "y": 328.47125633939686,
          "rotation": 0,
          "scale": 0.6528961722742556
        },
        {
          "junction": "band",
          "x": 186.9971483162855,
          "y": 284.8730905888427,
          "rotation": 0,
          "scale": 0.6528961722742556
        },
        {
          "r": 17.410564593980148,
          "smudge": true,
          "points": [
            [
              188.70818009424204,
              284.354064806098
            ],
            [
              189.84886794621306,
              284.354064806098
            ],
            [
              191.55989972416964,
              283.83503902335326
            ],
            [
              193.2709315021262,
              283.3160132406086
            ],
            [
              194.98196328008274,
              283.3160132406086
            ],
            [
              196.1226511320538,
              283.3160132406086
            ],
            [
              196.69299505803932,
              284.354064806098
            ],
            [
              194.98196328008274,
              289.5443226335449
            ],
            [
              190.9895557981841,
              299.4058125056941
            ],
            [
              186.9971483162855,
              311.343405508822
            ],
            [
              186.4268043903,
              314.97658598803486
            ],
            [
              185.85646046431444,
              318.6097664672477
            ],
            [
              184.71577261234341,
              323.80002429469465
            ],
            [
              184.71577261234341,
              324.838075860184
            ]
          ]
        },
        {
          "r": 17.410564593980148,
          "smudge": true,
          "points": [
            [
              166.4647669808068,
              282.2779616751192
            ],
            [
              167.0351109067923,
              283.3160132406086
            ],
            [
              167.6054548327778,
              284.354064806098
            ],
            [
              167.6054548327778,
              285.91114215433197
            ],
            [
              168.17579875876336,
              287.98724528531073
            ],
            [
              168.17579875876336,
              293.6965288955025
            ],
            [
              168.17579875876336,
              302.00094141941753
            ],
            [
              167.6054548327778,
              306.6721734641198
            ],
            [
              166.4647669808068,
              309.7863281605879
            ],
            [
              165.89442305482126,
              311.343405508822
            ]
          ]
        },
        {
          "r": 17.410564593980148,
          "smudge": true,
          "points": [
            [
              189.84886794621306,
              304.5960703331409
            ],
            [
              191.55989972416964,
              305.6341218986304
            ],
            [
              192.7005875761407,
              305.6341218986304
            ],
            [
              194.41161935409724,
              306.15314768137506
            ],
            [
              195.55230720606826,
              306.15314768137506
            ],
            [
              197.2633389840248,
              306.6721734641198
            ],
            [
              198.40402683599586,
              307.19119924686447
            ],
            [
              199.54471468796692,
              307.19119924686447
            ],
            [
              199.54471468796692,
              306.15314768137506
            ],
            [
              199.54471468796692,
              307.19119924686447
            ],
            [
              199.54471468796692,
              309.26730237784324
            ],
            [
              199.54471468796692,
              310.8243797260773
            ],
            [
              198.9743707619814,
              312.3814570743114
            ],
            [
              198.9743707619814,
              312.9004828570561
            ]
          ]
        },
        {
          "r": 17.410564593980148,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1452641045,
          "smoothing": 2.1763205742475185,
          "speck": 47.3637124189305,
          "points": [
            [
              188.70818009424204,
              300.44386407118344
            ],
            [
              188.70818009424204,
              299.4058125056941
            ],
            [
              189.84886794621306,
              298.3677609402047
            ],
            [
              190.9895557981841,
              297.84873515746
            ],
            [
              192.13024365015517,
              297.3297093747153
            ],
            [
              193.2709315021262,
              296.8106835919706
            ],
            [
              194.41161935409724,
              297.3297093747153
            ],
            [
              194.41161935409724,
              298.3677609402047
            ],
            [
              194.41161935409724,
              299.92483828843876
            ],
            [
              193.84127542811171,
              302.5199672021622
            ],
            [
              192.13024365015517,
              307.19119924686447
            ],
            [
              186.9971483162855,
              313.93853442254556
            ],
            [
              180.72336513044476,
              318.6097664672477
            ],
            [
              178.4419894265027,
              319.6478180327371
            ]
          ]
        },
        {
          "r": 17.410564593980148,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1022056883,
          "smoothing": 2.1763205742475185,
          "speck": 47.3637124189305,
          "points": [
            [
              177.8716455005172,
              285.39211637158735
            ],
            [
              179.01233335248824,
              284.8730905888427
            ],
            [
              180.15302120445924,
              285.39211637158735
            ],
            [
              180.72336513044476,
              286.43016793707676
            ],
            [
              181.2937090564303,
              287.98724528531073
            ],
            [
              181.2937090564303,
              290.0633484162896
            ],
            [
              181.2937090564303,
              292.65847733001306
            ],
            [
              181.2937090564303,
              295.77263202648123
            ],
            [
              181.2937090564303,
              298.3677609402047
            ],
            [
              180.72336513044476,
              300.96288985392823
            ],
            [
              180.15302120445924,
              303.5580187676516
            ],
            [
              179.58267727847374,
              305.1150961158857
            ],
            [
              179.01233335248824,
              306.6721734641198
            ],
            [
              178.4419894265027,
              307.71022502960915
            ]
          ]
        },
        {
          "r": 17.410564593980148,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1635777470,
          "smoothing": 2.1763205742475185,
          "speck": 47.3637124189305,
          "points": [
            [
              182.4343969084013,
              287.4682195025661
            ],
            [
              183.57508476037236,
              286.94919371982144
            ],
            [
              185.85646046431444,
              285.91114215433197
            ],
            [
              186.9971483162855,
              285.91114215433197
            ],
            [
              188.70818009424204,
              285.39211637158735
            ],
            [
              189.84886794621306,
              285.91114215433197
            ],
            [
              189.84886794621306,
              287.98724528531073
            ],
            [
              189.27852402022756,
              290.0633484162896
            ],
            [
              189.27852402022756,
              291.6204257645236
            ],
            [
              188.70818009424204,
              294.7345804609918
            ],
            [
              187.567492242271,
              302.00094141941753
            ],
            [
              186.4268043903,
              308.22925081235377
            ],
            [
              186.4268043903,
              312.3814570743114
            ],
            [
              185.85646046431444,
              317.0526891190136
            ],
            [
              184.1454286863579,
              322.24294694646056
            ],
            [
              182.4343969084013,
              327.4332047739075
            ],
            [
              181.2937090564303,
              332.62346260135445
            ],
            [
              179.58267727847374,
              336.2566430805673
            ],
            [
              177.8716455005172,
              339.3707977770354
            ],
            [
              176.73095764854614,
              338.85177199429074
            ]
          ]
        },
        {
          "r": 17.410564593980148,
          "tool": "clean",
          "strength": 0.5,
          "seed": 110972221,
          "smoothing": 2.1763205742475185,
          "speck": 47.3637124189305,
          "points": [
            [
              179.01233335248824,
              276.0496522821829
            ],
            [
              180.15302120445924,
              277.0877038476723
            ],
            [
              181.2937090564303,
              279.16380697865105
            ],
            [
              181.2937090564303,
              280.7208843268852
            ],
            [
              181.2937090564303,
              282.2779616751192
            ],
            [
              181.8640529824158,
              288.5062710680555
            ],
            [
              182.4343969084013,
              296.8106835919706
            ],
            [
              182.4343969084013,
              302.5199672021622
            ],
            [
              181.2937090564303,
              307.19119924686447
            ],
            [
              179.01233335248824,
              311.343405508822
            ],
            [
              175.01992587058956,
              315.49561177077953
            ],
            [
              170.45717446270544,
              319.6478180327371
            ],
            [
              164.75373520285024,
              323.80002429469465
            ],
            [
              160.19098379496606,
              328.9902821221416
            ],
            [
              157.90960809102398,
              331.58541103586504
            ]
          ]
        },
        {
          "r": 17.410564593980148,
          "tool": "clean",
          "strength": 0.5,
          "seed": 2119810200,
          "smoothing": 2.1763205742475185,
          "speck": 47.3637124189305,
          "points": [
            [
              179.58267727847374,
              242.83200218652252
            ],
            [
              180.72336513044476,
              242.83200218652252
            ],
            [
              180.15302120445924,
              243.87005375201193
            ],
            [
              178.4419894265027,
              248.54128579671413
            ],
            [
              175.59026979657511,
              260.9979045825868
            ],
            [
              174.44958194460406,
              276.56867806492755
            ],
            [
              175.01992587058956,
              291.6204257645236
            ],
            [
              175.01992587058956,
              307.19119924686447
            ],
            [
              173.87923801861854,
              320.1668438154818
            ],
            [
              171.02751838869094,
              332.1044368186097
            ],
            [
              166.4647669808068,
              343.52300403899307
            ],
            [
              160.7613277209516,
              354.94157125937613
            ],
            [
              155.62823238708194,
              367.9172158279936
            ],
            [
              150.49513705321226,
              381.93091196210037
            ],
            [
              145.36204171934256,
              398.02071122718576
            ],
            [
              142.51032208941498,
              406.84414953384544
            ]
          ]
        },
        {
          "junction": "band",
          "x": 190.5731956097,
          "y": 956.2420814479638,
          "rotation": 0,
          "scale": 0.6261519672846841
        },
        {
          "junction": "band",
          "x": 190.0028516837145,
          "y": 916.1425339366516,
          "rotation": 0,
          "scale": 0.6261519672846841
        },
        {
          "r": 16.697385794258242,
          "smudge": true,
          "points": [
            [
              188.29181990575796,
              915.6651583710408
            ],
            [
              187.15113205378694,
              915.6651583710408
            ],
            [
              185.44010027583036,
              915.1877828054298
            ],
            [
              183.7290684978738,
              914.710407239819
            ],
            [
              182.01803671991726,
              914.710407239819
            ],
            [
              180.8773488679462,
              914.710407239819
            ],
            [
              180.30700494196068,
              915.6651583710408
            ],
            [
              182.01803671991726,
              920.4389140271493
            ],
            [
              186.0104442018159,
              929.5090497737557
            ],
            [
              190.0028516837145,
              940.4886877828054
            ],
            [
              190.5731956097,
              943.8303167420814
            ],
            [
              191.14353953568556,
              947.1719457013575
            ],
            [
              192.28422738765659,
              951.9457013574661
            ],
            [
              192.28422738765659,
              952.9004524886877
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "smudge": true,
          "points": [
            [
              210.5352330191932,
              913.7556561085972
            ],
            [
              209.9648890932077,
              914.710407239819
            ],
            [
              209.3945451672222,
              915.6651583710408
            ],
            [
              209.3945451672222,
              917.0972850678733
            ],
            [
              208.82420124123664,
              919.0067873303167
            ],
            [
              208.82420124123664,
              924.2579185520362
            ],
            [
              208.82420124123664,
              931.89592760181
            ],
            [
              209.3945451672222,
              936.1923076923077
            ],
            [
              210.5352330191932,
              939.0565610859728
            ],
            [
              211.10557694517874,
              940.4886877828054
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "smudge": true,
          "points": [
            [
              187.15113205378694,
              934.2828054298642
            ],
            [
              185.44010027583036,
              935.237556561086
            ],
            [
              184.2994124238593,
              935.237556561086
            ],
            [
              182.58838064590276,
              935.7149321266968
            ],
            [
              181.44769279393174,
              935.7149321266968
            ],
            [
              179.7366610159752,
              936.1923076923077
            ],
            [
              178.59597316400414,
              936.6696832579186
            ],
            [
              177.45528531203308,
              936.6696832579186
            ],
            [
              177.45528531203308,
              935.7149321266968
            ],
            [
              177.45528531203308,
              936.6696832579186
            ],
            [
              177.45528531203308,
              938.579185520362
            ],
            [
              177.45528531203308,
              940.0113122171946
            ],
            [
              178.0256292380186,
              941.4434389140272
            ],
            [
              178.0256292380186,
              941.920814479638
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1452641045,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              188.29181990575796,
              930.4638009049773
            ],
            [
              188.29181990575796,
              929.5090497737557
            ],
            [
              187.15113205378694,
              928.5542986425339
            ],
            [
              186.0104442018159,
              928.0769230769231
            ],
            [
              184.86975634984483,
              927.5995475113123
            ],
            [
              183.7290684978738,
              927.1221719457013
            ],
            [
              182.58838064590276,
              927.5995475113123
            ],
            [
              182.58838064590276,
              928.5542986425339
            ],
            [
              182.58838064590276,
              929.9864253393665
            ],
            [
              183.15872457188829,
              932.3733031674208
            ],
            [
              184.86975634984483,
              936.6696832579186
            ],
            [
              190.0028516837145,
              942.8755656108598
            ],
            [
              196.27663486955524,
              947.1719457013575
            ],
            [
              198.5580105734973,
              948.1266968325792
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1022056883,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              199.1283544994828,
              916.6199095022624
            ],
            [
              197.98766664751176,
              916.1425339366516
            ],
            [
              196.84697879554076,
              916.6199095022624
            ],
            [
              196.27663486955524,
              917.5746606334842
            ],
            [
              195.7062909435697,
              919.0067873303167
            ],
            [
              195.7062909435697,
              920.9162895927602
            ],
            [
              195.7062909435697,
              923.3031674208145
            ],
            [
              195.7062909435697,
              926.1674208144797
            ],
            [
              195.7062909435697,
              928.5542986425339
            ],
            [
              196.27663486955524,
              930.9411764705883
            ],
            [
              196.84697879554076,
              933.3280542986425
            ],
            [
              197.41732272152626,
              934.7601809954751
            ],
            [
              197.98766664751176,
              936.1923076923077
            ],
            [
              198.5580105734973,
              937.1470588235294
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 1635777470,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              194.5656030915987,
              918.5294117647059
            ],
            [
              193.42491523962764,
              918.052036199095
            ],
            [
              191.14353953568556,
              917.0972850678733
            ],
            [
              190.0028516837145,
              917.0972850678733
            ],
            [
              188.29181990575796,
              916.6199095022624
            ],
            [
              187.15113205378694,
              917.0972850678733
            ],
            [
              187.15113205378694,
              919.0067873303167
            ],
            [
              187.72147597977244,
              920.9162895927602
            ],
            [
              187.72147597977244,
              922.3484162895927
            ],
            [
              188.29181990575796,
              925.2126696832579
            ],
            [
              189.432507757729,
              931.89592760181
            ],
            [
              190.5731956097,
              937.6244343891402
            ],
            [
              190.5731956097,
              941.4434389140272
            ],
            [
              191.14353953568556,
              945.7398190045249
            ],
            [
              192.8545713136421,
              950.5135746606335
            ],
            [
              194.5656030915987,
              955.2873303167421
            ],
            [
              195.7062909435697,
              960.0610859728507
            ],
            [
              197.41732272152626,
              963.4027149321267
            ],
            [
              199.1283544994828,
              966.2669683257918
            ],
            [
              200.26904235145386,
              965.789592760181
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 110972221,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              197.98766664751176,
              908.027149321267
            ],
            [
              196.84697879554076,
              908.9819004524887
            ],
            [
              195.7062909435697,
              910.8914027149322
            ],
            [
              195.7062909435697,
              912.3235294117648
            ],
            [
              195.7062909435697,
              913.7556561085972
            ],
            [
              195.1359470175842,
              919.4841628959276
            ],
            [
              194.5656030915987,
              927.1221719457013
            ],
            [
              194.5656030915987,
              932.3733031674208
            ],
            [
              195.7062909435697,
              936.6696832579186
            ],
            [
              197.98766664751176,
              940.4886877828054
            ],
            [
              201.98007412941044,
              944.3076923076923
            ],
            [
              206.54282553729456,
              948.1266968325792
            ],
            [
              212.24626479714976,
              951.9457013574661
            ],
            [
              216.80901620503394,
              956.7194570135747
            ],
            [
              219.09039190897602,
              959.106334841629
            ]
          ]
        },
        {
          "r": 16.697385794258242,
          "tool": "clean",
          "strength": 0.5,
          "seed": 2119810200,
          "smoothing": 2.0871732242822802,
          "speck": 43.56292068160891,
          "points": [
            [
              197.41732272152626,
              877.4751131221719
            ],
            [
              196.27663486955524,
              877.4751131221719
            ],
            [
              196.84697879554076,
              878.4298642533937
            ],
            [
              198.5580105734973,
              882.7262443438914
            ],
            [
              201.40973020342489,
              894.183257918552
            ],
            [
              202.55041805539594,
              908.5045248868778
            ],
            [
              201.98007412941044,
              922.3484162895927
            ],
            [
              201.98007412941044,
              936.6696832579186
            ],
            [
              203.12076198138146,
              948.60407239819
            ],
            [
              205.97248161130906,
              959.5837104072398
            ],
            [
              210.5352330191932,
              970.0859728506788
            ],
            [
              216.2386722790484,
              980.5882352941176
            ],
            [
              221.37176761291806,
              992.5226244343892
            ],
            [
              226.50486294678774,
              1005.4117647058824
            ],
            [
              231.63795828065744,
              1020.210407239819
            ],
            [
              234.48967791058502,
              1028.3257918552035
            ]
          ]
        }
      ],
      "anchor": {
        "rank": 0,
        "count": 2,
        "mount": {
          "x": 174,
          "y": 291,
          "ax": -0.7937940037885707,
          "ay": 0.6081867143807981,
          "len": 40.000000000000014
        }
      }
    }
  }
};

// Reusable shaft duplication: clone the complete B'shuakauitl mount/pair preset,
// then substitute the entire Torch-Staff sprite and its independently animated fire.
// Other shafts can be duplicated using the Foundry's "Duplicate shaft" editor action.
(function (config) {
  const source = config.shafts.bshuakauitl; // Canonical donor for the four eye/tang mounts and seven allowed head families.
  if (!source) return;
  const staff = JSON.parse(JSON.stringify(source)); // Copy, rather than alias, mount lines and fitting overrides.
  staff.label = 'Hachutu Torch-Staff';
  staff.sourceShape = 'hachutuTorchStaff'; // Own melee stats/grips; no B'shuakauitl blowgun behavior.
  staff.sprite = 'assets/toolsprites/hachutu_torch-staff.png';
  staff.duplicateFrom = 'bshuakauitl'; // Editor provenance; the copied pair settings remain independently editable.
  staff.duplicateTransform = { scaleX: 1, scaleY: 1, x: 0, y: 0 }; // Authorable whole-shaft transform, including sockets and live fire.
  staff.fireAssembly = 'hachutuTorchStaff'; // Shared layered weapon emitter follows this modular shaft at runtime.
  staff.editorOnly = false;
  config.shafts.hachutuTorchStaff = staff;
})(window.MODULAR_WEAPON_CONFIG);
