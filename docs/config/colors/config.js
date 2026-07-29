// Authoritative player body choices derived from NPC ranges, and exact clothing dye HSL values.
// Runtime recolors body, pattern, and clothing sprites with one shade-preserving transform. Edit with docs/tools/color-editor/.
(function () {
  'use strict';
  const bodyPalettes = {
  "mao-ao": {
    "male": [
      {
        "label": "Color 1",
        "h": -70,
        "s": -0.8,
        "v": -0.55
      },
      {
        "label": "Color 2",
        "h": -40,
        "s": -0.7,
        "v": -0.45
      },
      {
        "label": "Color 3",
        "h": 0,
        "s": -0.7,
        "v": -0.3
      },
      {
        "label": "Color 4",
        "h": 30,
        "s": -0.6,
        "v": -0.15
      },
      {
        "label": "Color 5",
        "h": 10,
        "s": -0.9,
        "v": 0.25
      },
      {
        "label": "Color 6",
        "h": 0,
        "s": -0.9,
        "v": -0.75
      },
      {
        "label": "Color 7",
        "h": -113,
        "s": -0.45,
        "v": -0.45
      },
      {
        "label": "Color 8",
        "h": -143,
        "s": -0.4,
        "v": -0.4
      },
      {
        "label": "Color 9",
        "h": -113,
        "s": -0.35,
        "v": -0.25
      },
      {
        "label": "Color 10",
        "h": -83,
        "s": -0.45,
        "v": -0.2
      },
      {
        "label": "Color 11",
        "h": -23,
        "s": -0.55,
        "v": -0.25
      },
      {
        "label": "Color 12",
        "h": 77,
        "s": -0.75,
        "v": -0.2
      }
    ],
    "female": [
      {
        "label": "Color 1",
        "h": -70,
        "s": -0.8,
        "v": -0.55
      },
      {
        "label": "Color 2",
        "h": -40,
        "s": -0.7,
        "v": -0.45
      },
      {
        "label": "Color 3",
        "h": 0,
        "s": -0.7,
        "v": -0.3
      },
      {
        "label": "Color 4",
        "h": 30,
        "s": -0.6,
        "v": -0.15
      },
      {
        "label": "Color 5",
        "h": 10,
        "s": -0.9,
        "v": 0.25
      },
      {
        "label": "Color 6",
        "h": 0,
        "s": -0.9,
        "v": -0.75
      },
      {
        "label": "Color 7",
        "h": -113,
        "s": -0.45,
        "v": -0.45
      },
      {
        "label": "Color 8",
        "h": -143,
        "s": -0.4,
        "v": -0.4
      },
      {
        "label": "Color 9",
        "h": -113,
        "s": -0.35,
        "v": -0.25
      },
      {
        "label": "Color 10",
        "h": -83,
        "s": -0.45,
        "v": -0.2
      },
      {
        "label": "Color 11",
        "h": -23,
        "s": -0.55,
        "v": -0.25
      },
      {
        "label": "Color 12",
        "h": 77,
        "s": -0.75,
        "v": -0.2
      }
    ]
  },
  "tletingan": {
    "male": [
      {
        "label": "Color 1",
        "h": -105,
        "s": -0.47,
        "v": -0.35
      },
      {
        "label": "Color 2",
        "h": -95,
        "s": -0.4586,
        "v": -0.3443
      },
      {
        "label": "Color 3",
        "h": -85,
        "s": -0.4471,
        "v": -0.3386
      },
      {
        "label": "Color 4",
        "h": -75,
        "s": -0.4357,
        "v": -0.3329
      },
      {
        "label": "Color 5",
        "h": -65,
        "s": -0.44,
        "v": -0.33
      },
      {
        "label": "Color 6",
        "h": -55,
        "s": -0.46,
        "v": -0.33
      },
      {
        "label": "Color 7",
        "h": -45,
        "s": -0.48,
        "v": -0.33
      },
      {
        "label": "Color 8",
        "h": -35,
        "s": -0.5,
        "v": -0.33
      },
      {
        "label": "Color 9",
        "h": -25,
        "s": -0.52,
        "v": -0.3362
      },
      {
        "label": "Color 10",
        "h": -15,
        "s": -0.54,
        "v": -0.3425
      },
      {
        "label": "Color 11",
        "h": -5,
        "s": -0.56,
        "v": -0.3488
      },
      {
        "label": "Color 12",
        "h": 5,
        "s": -0.58,
        "v": -0.355
      }
    ],
    "female": [
      {
        "label": "Color 1",
        "h": -105,
        "s": -0.47,
        "v": -0.35
      },
      {
        "label": "Color 2",
        "h": -95,
        "s": -0.4586,
        "v": -0.3443
      },
      {
        "label": "Color 3",
        "h": -85,
        "s": -0.4471,
        "v": -0.3386
      },
      {
        "label": "Color 4",
        "h": -75,
        "s": -0.4357,
        "v": -0.3329
      },
      {
        "label": "Color 5",
        "h": -65,
        "s": -0.44,
        "v": -0.33
      },
      {
        "label": "Color 6",
        "h": -55,
        "s": -0.46,
        "v": -0.33
      },
      {
        "label": "Color 7",
        "h": -45,
        "s": -0.48,
        "v": -0.33
      },
      {
        "label": "Color 8",
        "h": -35,
        "s": -0.5,
        "v": -0.33
      },
      {
        "label": "Color 9",
        "h": -25,
        "s": -0.52,
        "v": -0.3362
      },
      {
        "label": "Color 10",
        "h": -15,
        "s": -0.54,
        "v": -0.3425
      },
      {
        "label": "Color 11",
        "h": -5,
        "s": -0.56,
        "v": -0.3488
      },
      {
        "label": "Color 12",
        "h": 5,
        "s": -0.58,
        "v": -0.355
      }
    ]
  },
  "kenkari": {
    "male": [
      {
        "label": "Color 1",
        "h": -180,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 2",
        "h": -147.2727,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 3",
        "h": -114.5455,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 4",
        "h": -81.8182,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 5",
        "h": -49.0909,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 6",
        "h": -16.3636,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 7",
        "h": 16.3636,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 8",
        "h": 49.0909,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 9",
        "h": 81.8182,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 10",
        "h": 114.5455,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 11",
        "h": 147.2727,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 12",
        "h": 180,
        "s": 0.925,
        "v": -0.02
      }
    ],
    "female": [
      {
        "label": "Color 1",
        "h": -118,
        "s": -0.375,
        "v": -0.285
      },
      {
        "label": "Color 2",
        "h": -109.8182,
        "s": -0.3494,
        "v": -0.2756
      },
      {
        "label": "Color 3",
        "h": -101.6364,
        "s": -0.3239,
        "v": -0.2662
      },
      {
        "label": "Color 4",
        "h": -93.4545,
        "s": -0.2983,
        "v": -0.2569
      },
      {
        "label": "Color 5",
        "h": -85.2727,
        "s": -0.2727,
        "v": -0.2475
      },
      {
        "label": "Color 6",
        "h": -77.0909,
        "s": -0.2472,
        "v": -0.2381
      },
      {
        "label": "Color 7",
        "h": -68.9091,
        "s": -0.2218,
        "v": -0.2282
      },
      {
        "label": "Color 8",
        "h": -60.7273,
        "s": -0.1974,
        "v": -0.2145
      },
      {
        "label": "Color 9",
        "h": -52.5455,
        "s": -0.1731,
        "v": -0.2009
      },
      {
        "label": "Color 10",
        "h": -44.3636,
        "s": -0.1487,
        "v": -0.1873
      },
      {
        "label": "Color 11",
        "h": -36.1818,
        "s": -0.1244,
        "v": -0.1736
      },
      {
        "label": "Color 12",
        "h": -28,
        "s": -0.1,
        "v": -0.16
      }
    ]
  },
  "rakakoan": {
    "male": [
      {
        "label": "Color 1",
        "h": -180,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 2",
        "h": -147.2727,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 3",
        "h": -114.5455,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 4",
        "h": -81.8182,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 5",
        "h": -49.0909,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 6",
        "h": -16.3636,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 7",
        "h": 16.3636,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 8",
        "h": 49.0909,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 9",
        "h": 81.8182,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 10",
        "h": 114.5455,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 11",
        "h": 147.2727,
        "s": 0.925,
        "v": -0.02
      },
      {
        "label": "Color 12",
        "h": 180,
        "s": 0.925,
        "v": -0.02
      }
    ],
    "female": [
      {
        "label": "Color 1",
        "h": -118,
        "s": -0.375,
        "v": -0.285
      },
      {
        "label": "Color 2",
        "h": -109.8182,
        "s": -0.3494,
        "v": -0.2756
      },
      {
        "label": "Color 3",
        "h": -101.6364,
        "s": -0.3239,
        "v": -0.2662
      },
      {
        "label": "Color 4",
        "h": -93.4545,
        "s": -0.2983,
        "v": -0.2569
      },
      {
        "label": "Color 5",
        "h": -85.2727,
        "s": -0.2727,
        "v": -0.2475
      },
      {
        "label": "Color 6",
        "h": -77.0909,
        "s": -0.2472,
        "v": -0.2381
      },
      {
        "label": "Color 7",
        "h": -68.9091,
        "s": -0.2218,
        "v": -0.2282
      },
      {
        "label": "Color 8",
        "h": -60.7273,
        "s": -0.1974,
        "v": -0.2145
      },
      {
        "label": "Color 9",
        "h": -52.5455,
        "s": -0.1731,
        "v": -0.2009
      },
      {
        "label": "Color 10",
        "h": -44.3636,
        "s": -0.1487,
        "v": -0.1873
      },
      {
        "label": "Color 11",
        "h": -36.1818,
        "s": -0.1244,
        "v": -0.1736
      },
      {
        "label": "Color 12",
        "h": -28,
        "s": -0.1,
        "v": -0.16
      }
    ]
  },
  "engh-sho": {
    "male": [
      {
        "label": "Color 1",
        "h": -70,
        "s": -0.8,
        "v": -0.55
      },
      {
        "label": "Color 2",
        "h": -40,
        "s": -0.7,
        "v": -0.45
      },
      {
        "label": "Color 3",
        "h": 0,
        "s": -0.7,
        "v": -0.3
      },
      {
        "label": "Color 4",
        "h": 30,
        "s": -0.6,
        "v": -0.15
      },
      {
        "label": "Color 5",
        "h": 10,
        "s": -0.9,
        "v": 0.25
      },
      {
        "label": "Color 6",
        "h": 0,
        "s": -0.9,
        "v": -0.75
      },
      {
        "label": "Color 7",
        "h": -113,
        "s": -0.45,
        "v": -0.45
      },
      {
        "label": "Color 8",
        "h": -143,
        "s": -0.4,
        "v": -0.4
      },
      {
        "label": "Color 9",
        "h": -113,
        "s": -0.35,
        "v": -0.25
      },
      {
        "label": "Color 10",
        "h": -83,
        "s": -0.45,
        "v": -0.2
      },
      {
        "label": "Color 11",
        "h": -23,
        "s": -0.55,
        "v": -0.25
      },
      {
        "label": "Color 12",
        "h": 77,
        "s": -0.75,
        "v": -0.2
      }
    ],
    "female": [
      {
        "label": "Color 1",
        "h": -70,
        "s": -0.8,
        "v": -0.55
      },
      {
        "label": "Color 2",
        "h": -40,
        "s": -0.7,
        "v": -0.45
      },
      {
        "label": "Color 3",
        "h": 0,
        "s": -0.7,
        "v": -0.3
      },
      {
        "label": "Color 4",
        "h": 30,
        "s": -0.6,
        "v": -0.15
      },
      {
        "label": "Color 5",
        "h": 10,
        "s": -0.9,
        "v": 0.25
      },
      {
        "label": "Color 6",
        "h": 0,
        "s": -0.9,
        "v": -0.75
      },
      {
        "label": "Color 7",
        "h": -113,
        "s": -0.45,
        "v": -0.45
      },
      {
        "label": "Color 8",
        "h": -143,
        "s": -0.4,
        "v": -0.4
      },
      {
        "label": "Color 9",
        "h": -113,
        "s": -0.35,
        "v": -0.25
      },
      {
        "label": "Color 10",
        "h": -83,
        "s": -0.45,
        "v": -0.2
      },
      {
        "label": "Color 11",
        "h": -23,
        "s": -0.55,
        "v": -0.25
      },
      {
        "label": "Color 12",
        "h": 77,
        "s": -0.75,
        "v": -0.2
      }
    ]
  },
  "mashtzarr": {
    "male": [
      {
        "label": "Color 1",
        "h": -70,
        "s": -0.8,
        "v": -0.55
      },
      {
        "label": "Color 2",
        "h": -40,
        "s": -0.7,
        "v": -0.45
      },
      {
        "label": "Color 3",
        "h": 0,
        "s": -0.7,
        "v": -0.3
      },
      {
        "label": "Color 4",
        "h": 30,
        "s": -0.6,
        "v": -0.15
      },
      {
        "label": "Color 5",
        "h": 10,
        "s": -0.9,
        "v": 0.25
      },
      {
        "label": "Color 6",
        "h": 0,
        "s": -0.9,
        "v": -0.75
      },
      {
        "label": "Color 7",
        "h": -113,
        "s": -0.45,
        "v": -0.45
      },
      {
        "label": "Color 8",
        "h": -143,
        "s": -0.4,
        "v": -0.4
      },
      {
        "label": "Color 9",
        "h": -113,
        "s": -0.35,
        "v": -0.25
      },
      {
        "label": "Color 10",
        "h": -83,
        "s": -0.45,
        "v": -0.2
      },
      {
        "label": "Color 11",
        "h": -23,
        "s": -0.55,
        "v": -0.25
      },
      {
        "label": "Color 12",
        "h": 77,
        "s": -0.75,
        "v": -0.2
      }
    ],
    "female": [
      {
        "label": "Color 1",
        "h": -70,
        "s": -0.8,
        "v": -0.55
      },
      {
        "label": "Color 2",
        "h": -40,
        "s": -0.7,
        "v": -0.45
      },
      {
        "label": "Color 3",
        "h": 0,
        "s": -0.7,
        "v": -0.3
      },
      {
        "label": "Color 4",
        "h": 30,
        "s": -0.6,
        "v": -0.15
      },
      {
        "label": "Color 5",
        "h": 10,
        "s": -0.9,
        "v": 0.25
      },
      {
        "label": "Color 6",
        "h": 0,
        "s": -0.9,
        "v": -0.75
      },
      {
        "label": "Color 7",
        "h": -113,
        "s": -0.45,
        "v": -0.45
      },
      {
        "label": "Color 8",
        "h": -143,
        "s": -0.4,
        "v": -0.4
      },
      {
        "label": "Color 9",
        "h": -113,
        "s": -0.35,
        "v": -0.25
      },
      {
        "label": "Color 10",
        "h": -83,
        "s": -0.45,
        "v": -0.2
      },
      {
        "label": "Color 11",
        "h": -23,
        "s": -0.55,
        "v": -0.25
      },
      {
        "label": "Color 12",
        "h": 77,
        "s": -0.75,
        "v": -0.2
      }
    ]
  }
};
  const dyeHsl = [
  {
    "id": "dye:CLOTH:pure_red",
    "label": "Pure Red",
    "hsl": {
      "h": 0,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_red",
    "label": "Bright Red",
    "hsl": {
      "h": 0,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_red",
    "label": "Pale Red",
    "hsl": {
      "h": 0,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_red",
    "label": "Deep Red",
    "hsl": {
      "h": 0,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_red",
    "label": "Muted Red",
    "hsl": {
      "h": 0,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_red",
    "label": "Dusty Red",
    "hsl": {
      "h": 0,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_red",
    "label": "Shadow Red",
    "hsl": {
      "h": 0,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_red",
    "label": "Dark Muted Red",
    "hsl": {
      "h": 0,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_red",
    "label": "Smoky Red",
    "hsl": {
      "h": 0,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_red_orange",
    "label": "Pure Red-Orange",
    "hsl": {
      "h": 15.06,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_red_orange",
    "label": "Bright Red-Orange",
    "hsl": {
      "h": 14.9,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_red_orange",
    "label": "Pale Red-Orange",
    "hsl": {
      "h": 15,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_red_orange",
    "label": "Deep Red-Orange",
    "hsl": {
      "h": 15,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_red_orange",
    "label": "Muted Red-Orange",
    "hsl": {
      "h": 15,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_red_orange",
    "label": "Dusty Red-Orange",
    "hsl": {
      "h": 15.71,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_red_orange",
    "label": "Shadow Red-Orange",
    "hsl": {
      "h": 14.83,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_red_orange",
    "label": "Dark Muted Red-Orange",
    "hsl": {
      "h": 14.72,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_red_orange",
    "label": "Smoky Red-Orange",
    "hsl": {
      "h": 15.56,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_orange",
    "label": "Pure Orange",
    "hsl": {
      "h": 30.12,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_orange",
    "label": "Bright Orange",
    "hsl": {
      "h": 30.2,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_orange",
    "label": "Pale Orange",
    "hsl": {
      "h": 30,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_orange",
    "label": "Deep Orange",
    "hsl": {
      "h": 30,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_orange",
    "label": "Muted Orange",
    "hsl": {
      "h": 30,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_orange",
    "label": "Dusty Orange",
    "hsl": {
      "h": 30,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_orange",
    "label": "Shadow Orange",
    "hsl": {
      "h": 30.34,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_orange",
    "label": "Dark Muted Orange",
    "hsl": {
      "h": 29.43,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_orange",
    "label": "Smoky Orange",
    "hsl": {
      "h": 31.11,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_yellow_orange",
    "label": "Pure Yellow-Orange",
    "hsl": {
      "h": 44.94,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_yellow_orange",
    "label": "Bright Yellow-Orange",
    "hsl": {
      "h": 45.1,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_yellow_orange",
    "label": "Pale Yellow-Orange",
    "hsl": {
      "h": 45,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_yellow_orange",
    "label": "Deep Yellow-Orange",
    "hsl": {
      "h": 45,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_yellow_orange",
    "label": "Muted Yellow-Orange",
    "hsl": {
      "h": 45,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_yellow_orange",
    "label": "Dusty Yellow-Orange",
    "hsl": {
      "h": 45.71,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_yellow_orange",
    "label": "Shadow Yellow-Orange",
    "hsl": {
      "h": 45.17,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_yellow_orange",
    "label": "Dark Muted Yellow-Orange",
    "hsl": {
      "h": 45.28,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_yellow_orange",
    "label": "Smoky Yellow-Orange",
    "hsl": {
      "h": 46.67,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_yellow",
    "label": "Pure Yellow",
    "hsl": {
      "h": 60,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_yellow",
    "label": "Bright Yellow",
    "hsl": {
      "h": 60,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_yellow",
    "label": "Pale Yellow",
    "hsl": {
      "h": 60,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_yellow",
    "label": "Deep Yellow",
    "hsl": {
      "h": 60,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_yellow",
    "label": "Muted Yellow",
    "hsl": {
      "h": 60,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_yellow",
    "label": "Dusty Yellow",
    "hsl": {
      "h": 60,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_yellow",
    "label": "Shadow Yellow",
    "hsl": {
      "h": 60,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_yellow",
    "label": "Dark Muted Yellow",
    "hsl": {
      "h": 60,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_yellow",
    "label": "Smoky Yellow",
    "hsl": {
      "h": 60,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_yellow_green",
    "label": "Pure Yellow-Green",
    "hsl": {
      "h": 89.88,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_yellow_green",
    "label": "Bright Yellow-Green",
    "hsl": {
      "h": 89.8,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_yellow_green",
    "label": "Pale Yellow-Green",
    "hsl": {
      "h": 90,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_yellow_green",
    "label": "Deep Yellow-Green",
    "hsl": {
      "h": 90,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_yellow_green",
    "label": "Muted Yellow-Green",
    "hsl": {
      "h": 90,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_yellow_green",
    "label": "Dusty Yellow-Green",
    "hsl": {
      "h": 90,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_yellow_green",
    "label": "Shadow Yellow-Green",
    "hsl": {
      "h": 89.66,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_yellow_green",
    "label": "Dark Muted Yellow-Green",
    "hsl": {
      "h": 90.57,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_yellow_green",
    "label": "Smoky Yellow-Green",
    "hsl": {
      "h": 88.89,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_green",
    "label": "Pure Green",
    "hsl": {
      "h": 120,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_green",
    "label": "Bright Green",
    "hsl": {
      "h": 120,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_green",
    "label": "Pale Green",
    "hsl": {
      "h": 120,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_green",
    "label": "Deep Green",
    "hsl": {
      "h": 120,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_green",
    "label": "Muted Green",
    "hsl": {
      "h": 120,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_green",
    "label": "Dusty Green",
    "hsl": {
      "h": 120,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_green",
    "label": "Shadow Green",
    "hsl": {
      "h": 120,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_green",
    "label": "Dark Muted Green",
    "hsl": {
      "h": 120,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_green",
    "label": "Smoky Green",
    "hsl": {
      "h": 120,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_green_blue",
    "label": "Pure Green-Blue",
    "hsl": {
      "h": 180,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_green_blue",
    "label": "Bright Green-Blue",
    "hsl": {
      "h": 180,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_green_blue",
    "label": "Pale Green-Blue",
    "hsl": {
      "h": 180,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_green_blue",
    "label": "Deep Green-Blue",
    "hsl": {
      "h": 180,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_green_blue",
    "label": "Muted Green-Blue",
    "hsl": {
      "h": 180,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_green_blue",
    "label": "Dusty Green-Blue",
    "hsl": {
      "h": 180,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_green_blue",
    "label": "Shadow Green-Blue",
    "hsl": {
      "h": 180,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_green_blue",
    "label": "Dark Muted Green-Blue",
    "hsl": {
      "h": 180,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_green_blue",
    "label": "Smoky Green-Blue",
    "hsl": {
      "h": 180,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_blue",
    "label": "Pure Blue",
    "hsl": {
      "h": 200,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_blue",
    "label": "Bright Blue",
    "hsl": {
      "h": 200,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_blue",
    "label": "Pale Blue",
    "hsl": {
      "h": 200,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_blue",
    "label": "Deep Blue",
    "hsl": {
      "h": 200,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_blue",
    "label": "Muted Blue",
    "hsl": {
      "h": 200,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_blue",
    "label": "Dusty Blue",
    "hsl": {
      "h": 200,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_blue",
    "label": "Shadow Blue",
    "hsl": {
      "h": 200,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_blue",
    "label": "Dark Muted Blue",
    "hsl": {
      "h": 200,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_blue",
    "label": "Smoky Blue",
    "hsl": {
      "h": 200,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_blue_indigo",
    "label": "Pure Blue-Indigo",
    "hsl": {
      "h": 255.06,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_blue_indigo",
    "label": "Bright Blue-Indigo",
    "hsl": {
      "h": 254.9,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_blue_indigo",
    "label": "Pale Blue-Indigo",
    "hsl": {
      "h": 255,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_blue_indigo",
    "label": "Deep Blue-Indigo",
    "hsl": {
      "h": 255,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_blue_indigo",
    "label": "Muted Blue-Indigo",
    "hsl": {
      "h": 255,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_blue_indigo",
    "label": "Dusty Blue-Indigo",
    "hsl": {
      "h": 255.71,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_blue_indigo",
    "label": "Shadow Blue-Indigo",
    "hsl": {
      "h": 254.83,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_blue_indigo",
    "label": "Dark Muted Blue-Indigo",
    "hsl": {
      "h": 254.72,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_blue_indigo",
    "label": "Smoky Blue-Indigo",
    "hsl": {
      "h": 255.56,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_indigo",
    "label": "Pure Indigo",
    "hsl": {
      "h": 270.12,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_indigo",
    "label": "Bright Indigo",
    "hsl": {
      "h": 270.2,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_indigo",
    "label": "Pale Indigo",
    "hsl": {
      "h": 270,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_indigo",
    "label": "Deep Indigo",
    "hsl": {
      "h": 270,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_indigo",
    "label": "Muted Indigo",
    "hsl": {
      "h": 270,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_indigo",
    "label": "Dusty Indigo",
    "hsl": {
      "h": 270,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_indigo",
    "label": "Shadow Indigo",
    "hsl": {
      "h": 270.34,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_indigo",
    "label": "Dark Muted Indigo",
    "hsl": {
      "h": 269.43,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_indigo",
    "label": "Smoky Indigo",
    "hsl": {
      "h": 271.11,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_indigo_violet",
    "label": "Pure Indigo-Violet",
    "hsl": {
      "h": 284.94,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_indigo_violet",
    "label": "Bright Indigo-Violet",
    "hsl": {
      "h": 285.1,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_indigo_violet",
    "label": "Pale Indigo-Violet",
    "hsl": {
      "h": 285,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_indigo_violet",
    "label": "Deep Indigo-Violet",
    "hsl": {
      "h": 285,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_indigo_violet",
    "label": "Muted Indigo-Violet",
    "hsl": {
      "h": 285,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_indigo_violet",
    "label": "Dusty Indigo-Violet",
    "hsl": {
      "h": 285.71,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_indigo_violet",
    "label": "Shadow Indigo-Violet",
    "hsl": {
      "h": 285.17,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_indigo_violet",
    "label": "Dark Muted Indigo-Violet",
    "hsl": {
      "h": 285.28,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_indigo_violet",
    "label": "Smoky Indigo-Violet",
    "hsl": {
      "h": 286.67,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:pure_violet",
    "label": "Pure Violet",
    "hsl": {
      "h": 300,
      "s": 100,
      "l": 50
    }
  },
  {
    "id": "dye:CLOTH:bright_violet",
    "label": "Bright Violet",
    "hsl": {
      "h": 300,
      "s": 100,
      "l": 70
    }
  },
  {
    "id": "dye:CLOTH:pale_violet",
    "label": "Pale Violet",
    "hsl": {
      "h": 300,
      "s": 100,
      "l": 85.1
    }
  },
  {
    "id": "dye:CLOTH:deep_violet",
    "label": "Deep Violet",
    "hsl": {
      "h": 300,
      "s": 100,
      "l": 27.45
    }
  },
  {
    "id": "dye:CLOTH:muted_violet",
    "label": "Muted Violet",
    "hsl": {
      "h": 300,
      "s": 42.86,
      "l": 38.43
    }
  },
  {
    "id": "dye:CLOTH:dusty_violet",
    "label": "Dusty Violet",
    "hsl": {
      "h": 300,
      "s": 17.65,
      "l": 46.67
    }
  },
  {
    "id": "dye:CLOTH:shadow_violet",
    "label": "Shadow Violet",
    "hsl": {
      "h": 300,
      "s": 100,
      "l": 17.45
    }
  },
  {
    "id": "dye:CLOTH:dark_muted_violet",
    "label": "Dark Muted Violet",
    "hsl": {
      "h": 300,
      "s": 42.4,
      "l": 24.51
    }
  },
  {
    "id": "dye:CLOTH:smoky_violet",
    "label": "Smoky Violet",
    "hsl": {
      "h": 300,
      "s": 17.88,
      "l": 29.61
    }
  },
  {
    "id": "dye:CLOTH:white",
    "label": "White",
    "hsl": {
      "h": 0,
      "s": 0,
      "l": 100
    }
  },
  {
    "id": "dye:CLOTH:silver",
    "label": "Silver",
    "hsl": {
      "h": 0,
      "s": 0,
      "l": 75.29
    }
  },
  {
    "id": "dye:CLOTH:gray",
    "label": "Gray",
    "hsl": {
      "h": 0,
      "s": 0,
      "l": 50.2
    }
  },
  {
    "id": "dye:CLOTH:charcoal",
    "label": "Charcoal",
    "hsl": {
      "h": 0,
      "s": 0,
      "l": 20
    }
  },
  {
    "id": "dye:CLOTH:cream",
    "label": "Cream",
    "hsl": {
      "h": 42.35,
      "s": 100,
      "l": 90
    }
  },
  {
    "id": "dye:CLOTH:brown",
    "label": "Brown",
    "hsl": {
      "h": 26.51,
      "s": 54.43,
      "l": 30.98
    }
  }
];
  window.HOBUNJI_COLOR_CONFIG = { bodyPalettes, dyeHsl };
  window.applyHobunjiColorConfig?.(window.HOBUNJI_COLOR_CONFIG);
})();
