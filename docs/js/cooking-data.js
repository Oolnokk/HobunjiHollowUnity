(() => {
  'use strict';

  // Cooking content ported from HHCookingUIV2. This data-only module has no
  // game-state or DOM dependencies, so recipes/items can be tested in isolation.
  window.HobunjiCookingData = {
  "categoryLabels": {
    "sweetPaste": "Sweet Paste",
    "sweetLiquid": "Sweet Liquid",
    "liquor": "Liquor",
    "grain": "Grain",
    "powder": "Dry Powder",
    "curds": "Curd",
    "mayonnaise": "Mayonnaise",
    "mustardSeed": "Mustard Seed",
    "pungentPaste": "Pungent Paste",
    "noodleBase": "Noodle Base",
    "cheese": "Cheese",
    "poultry": "Poultry",
    "meat": "Meat",
    "whiteMilk": "White Milk",
    "seeds": "Seeds",
    "spice": "Spice",
    "fish": "Fish",
    "mollusk": "Mollusk",
    "starchVegetable": "Starch Vegetable",
    "butter": "Butter",
    "vegetable": "Vegetable",
    "brothBase": "Broth Base",
    "berry": "Berry",
    "fruit": "Fruit",
    "flour": "Flour",
    "bread": "Bread",
    "oil": "Oil",
    "nut": "Nut",
    "egg": "Egg",
    "dairy": "Dairy",
    "sauce": "Sauce",
    "juice": "Juice",
    "wine": "Wine",
    "mead": "Mead",
    "wool": "Wool",
    "herb": "Herb",
    "mineral": "Mineral",
    "material": "Material",
    "crop": "Crop",
    "processedCrop": "Processed Crop",
    "processedProtein": "Processed Protein",
    "uumkaoiiDew": "Uumkao’ii Dew",
    "uumkaoiiMilk": "Uumkao’ii Milk",
    "uumkaoiiCurds": "Uumkao’ii Curds",
    "uumkaoiiCheese": "Uumkao’ii Cheese",
    "whiteCurds": "White Curds",
    "whiteCheese": "White Cheese"
  },
  "effectLabels": {
    "strength": "Strength",
    "fortitude": "Fortitude",
    "vigor": "Vigor",
    "speed": "Speed",
    "perception": "Perception",
    "clarity": "Clarity",
    "combat": "Combat",
    "farming": "Farming",
    "fishing": "Fishing",
    "foraging": "Foraging",
    "crafting": "Crafting",
    "mining": "Mining"
  },
  "effectPrefixVariants": {
    "strength": [
      "Strong",
      "Mighty",
      "Stout",
      "Powerful"
    ],
    "fortitude": [
      "Fortified",
      "Stalwart",
      "Hardy",
      "Steadfast"
    ],
    "vigor": [
      "Vigorous",
      "Energizing",
      "Lively",
      "Brisk"
    ],
    "speed": [
      "Swift",
      "Fleet",
      "Quick",
      "Rapid"
    ],
    "perception": [
      "Keen",
      "Watchful",
      "Sharp-Sensed",
      "Alert"
    ],
    "clarity": [
      "Clear",
      "Focused",
      "Lucid",
      "Bright-Minded"
    ],
    "combat": [
      "Fighter's",
      "Battle-Ready",
      "Warrior's",
      "Bold"
    ],
    "farming": [
      "Farmhand's",
      "Harvest",
      "Fieldwise",
      "Homestead"
    ],
    "fishing": [
      "Fisher's",
      "Riverwise",
      "Angler's",
      "Waterside"
    ],
    "foraging": [
      "Forager's",
      "Wildpicked",
      "Trailwise",
      "Woodland"
    ],
    "crafting": [
      "Crafter's",
      "Handmade",
      "Artisan",
      "Workshop"
    ],
    "mining": [
      "Miner's",
      "Stonewise",
      "Deepdelver's",
      "Cavern"
    ]
  },
  "processingTiers": {
    "raw": {
      "label": "Raw / Harvested",
      "multiplier": 1
    },
    "quick": {
      "label": "Quick Process",
      "multiplier": 1.5
    },
    "medium": {
      "label": "Medium Process",
      "multiplier": 2.5
    },
    "long": {
      "label": "Long Process",
      "multiplier": 3.5
    }
  },
  "items": {
    "yellowDew": {
      "id": "yellowDew",
      "name": "Yellow Uumkao’ii Dew",
      "categories": [
        "sweetPaste"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "farming",
      "tags": [
        "Dry Season",
        "Farm",
        "Sweet Dew"
      ]
    },
    "greenDew": {
      "id": "greenDew",
      "name": "Green Uumkao’ii Dew",
      "categories": [
        "sweetPaste"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fishing",
      "tags": [
        "Wet Season",
        "Farm",
        "Sweet Dew"
      ]
    },
    "blueDew": {
      "id": "blueDew",
      "name": "Blue Uumkao’ii Dew",
      "categories": [
        "sweetPaste"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "vigor",
      "tags": [
        "Cloud Forest",
        "Blue Moss",
        "Wet Season"
      ]
    },
    "orangeDew": {
      "id": "orangeDew",
      "name": "Orange Uumkao’ii Dew",
      "categories": [
        "sweetPaste"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fortitude",
      "tags": [
        "Cloud Forest",
        "Vacant Hivewood",
        "Dry Season"
      ]
    },
    "redDew": {
      "id": "redDew",
      "name": "Red Uumkao’ii Dew",
      "categories": [
        "sweetPaste"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "combat",
      "tags": [
        "Northern Cliffs",
        "Red Berry Bushes",
        "Dry Season"
      ]
    },
    "purpleDew": {
      "id": "purpleDew",
      "name": "Purple Uumkao’ii Dew",
      "categories": [
        "sweetPaste"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "perception",
      "tags": [
        "Mire",
        "Dark Mushrooms",
        "Wet Season"
      ]
    },
    "whiteDew": {
      "id": "whiteDew",
      "name": "White Uumkao’ii Dew",
      "categories": [
        "sweetPaste"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "clarity",
      "tags": [
        "Mire",
        "Pale Mushrooms",
        "Dry Season"
      ]
    },
    "yellowDewMilk": {
      "id": "yellowDewMilk",
      "name": "Yellow Uumkao’ii Milk",
      "categories": [
        "sweetLiquid"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "farming",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Animal Milk"
      ],
      "sourceItemId": "yellowDew"
    },
    "yellowDewCurds": {
      "id": "yellowDewCurds",
      "name": "Yellow Uumkao’ii Curds",
      "categories": [
        "sweetPaste",
        "curds"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "farming",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Dairy"
      ],
      "sourceItemId": "yellowDew"
    },
    "greenDewMilk": {
      "id": "greenDewMilk",
      "name": "Green Uumkao’ii Milk",
      "categories": [
        "sweetLiquid"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "fishing",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Animal Milk"
      ],
      "sourceItemId": "greenDew"
    },
    "greenDewCurds": {
      "id": "greenDewCurds",
      "name": "Green Uumkao’ii Curds",
      "categories": [
        "sweetPaste",
        "curds"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "fishing",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Dairy"
      ],
      "sourceItemId": "greenDew"
    },
    "blueDewMilk": {
      "id": "blueDewMilk",
      "name": "Blue Uumkao’ii Milk",
      "categories": [
        "sweetLiquid"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "vigor",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Animal Milk"
      ],
      "sourceItemId": "blueDew"
    },
    "blueDewCurds": {
      "id": "blueDewCurds",
      "name": "Blue Uumkao’ii Curds",
      "categories": [
        "sweetPaste",
        "curds"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "vigor",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Dairy"
      ],
      "sourceItemId": "blueDew"
    },
    "orangeDewMilk": {
      "id": "orangeDewMilk",
      "name": "Orange Uumkao’ii Milk",
      "categories": [
        "sweetLiquid"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "fortitude",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Animal Milk"
      ],
      "sourceItemId": "orangeDew"
    },
    "orangeDewCurds": {
      "id": "orangeDewCurds",
      "name": "Orange Uumkao’ii Curds",
      "categories": [
        "sweetPaste",
        "curds"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "fortitude",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Dairy"
      ],
      "sourceItemId": "orangeDew"
    },
    "redDewMilk": {
      "id": "redDewMilk",
      "name": "Red Uumkao’ii Milk",
      "categories": [
        "sweetLiquid"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "combat",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Animal Milk"
      ],
      "sourceItemId": "redDew"
    },
    "redDewCurds": {
      "id": "redDewCurds",
      "name": "Red Uumkao’ii Curds",
      "categories": [
        "sweetPaste",
        "curds"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "combat",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Dairy"
      ],
      "sourceItemId": "redDew"
    },
    "purpleDewMilk": {
      "id": "purpleDewMilk",
      "name": "Purple Uumkao’ii Milk",
      "categories": [
        "sweetLiquid"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "perception",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Animal Milk"
      ],
      "sourceItemId": "purpleDew"
    },
    "purpleDewCurds": {
      "id": "purpleDewCurds",
      "name": "Purple Uumkao’ii Curds",
      "categories": [
        "sweetPaste",
        "curds"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "perception",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Dairy"
      ],
      "sourceItemId": "purpleDew"
    },
    "uumkaoiiWhiteDewMilk": {
      "id": "uumkaoiiWhiteDewMilk",
      "name": "White Uumkao’ii Milk",
      "categories": [
        "sweetLiquid"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "clarity",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Animal Milk"
      ],
      "sourceItemId": "whiteDew"
    },
    "uumkaoiiWhiteDewCurds": {
      "id": "uumkaoiiWhiteDewCurds",
      "name": "White Uumkao’ii Curds",
      "categories": [
        "sweetPaste",
        "curds"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "clarity",
      "tags": [
        "Uumkao’ii",
        "Dew",
        "Squeezed",
        "Not Dairy"
      ],
      "sourceItemId": "whiteDew"
    },
    "needlegrain": {
      "id": "needlegrain",
      "name": "Needlegrain",
      "categories": [
        "grain",
        "crop"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "farming",
      "tags": [
        "Grain",
        "Crop"
      ]
    },
    "heftroot": {
      "id": "heftroot",
      "name": "Heftroot",
      "categories": [
        "starchVegetable",
        "vegetable",
        "crop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fortitude",
      "tags": [
        "Root",
        "Crop"
      ]
    },
    "garlink": {
      "id": "garlink",
      "name": "Garlink",
      "categories": [
        "vegetable",
        "spice",
        "crop",
        "brothBase"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "combat",
      "tags": [
        "Pungent",
        "Crop"
      ]
    },
    "ongyums": {
      "id": "ongyums",
      "name": "Ongyums",
      "categories": [
        "vegetable",
        "brothBase",
        "crop"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "clarity",
      "tags": [
        "Aromatic",
        "Crop"
      ]
    },
    "redberries": {
      "id": "redberries",
      "name": "Redberries",
      "categories": [
        "berry",
        "fruit",
        "crop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fortitude",
      "tags": [
        "Berry",
        "Red"
      ]
    },
    "blueberries": {
      "id": "blueberries",
      "name": "Blueberries",
      "categories": [
        "berry",
        "fruit",
        "crop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fishing",
      "tags": [
        "Berry",
        "Blue"
      ]
    },
    "yellowberries": {
      "id": "yellowberries",
      "name": "Yellowberries",
      "categories": [
        "berry",
        "fruit",
        "crop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "speed",
      "tags": [
        "Berry",
        "Yellow"
      ]
    },
    "whiteberries": {
      "id": "whiteberries",
      "name": "Whiteberries",
      "categories": [
        "berry",
        "fruit",
        "crop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "clarity",
      "tags": [
        "Berry",
        "White"
      ]
    },
    "blackberries": {
      "id": "blackberries",
      "name": "Blackberries",
      "categories": [
        "berry",
        "fruit",
        "crop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "speed",
      "tags": [
        "Berry",
        "Black"
      ]
    },
    "blackMustard": {
      "id": "blackMustard",
      "name": "Black Mustard",
      "categories": [
        "vegetable",
        "spice",
        "crop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "combat",
      "tags": [
        "Mustard",
        "Hot",
        "Crop"
      ]
    },
    "greenMustard": {
      "id": "greenMustard",
      "name": "Green Mustard",
      "categories": [
        "vegetable",
        "spice",
        "crop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "foraging",
      "tags": [
        "Mustard",
        "Fresh",
        "Crop"
      ]
    },
    "needlegrainSeeds": {
      "id": "needlegrainSeeds",
      "name": "Needlegrain Seeds",
      "categories": [
        "seeds"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "farming",
      "tags": [
        "Seed",
        "Needlegrain"
      ]
    },
    "grassSeeds": {
      "id": "grassSeeds",
      "name": "Grass Seeds",
      "categories": [
        "grain",
        "seeds"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "foraging",
      "tags": [
        "Seed",
        "Grass",
        "Grain"
      ]
    },
    "redberrySeeds": {
      "id": "redberrySeeds",
      "name": "Redberry Seeds",
      "categories": [
        "seeds"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fortitude",
      "tags": [
        "Seed",
        "Berry",
        "Implied"
      ]
    },
    "blueberrySeeds": {
      "id": "blueberrySeeds",
      "name": "Blueberry Seeds",
      "categories": [
        "seeds"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fishing",
      "tags": [
        "Seed",
        "Berry",
        "Implied"
      ]
    },
    "yellowberrySeeds": {
      "id": "yellowberrySeeds",
      "name": "Yellowberry Seeds",
      "categories": [
        "seeds"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "speed",
      "tags": [
        "Seed",
        "Berry",
        "Implied"
      ]
    },
    "whiteberrySeeds": {
      "id": "whiteberrySeeds",
      "name": "Whiteberry Seeds",
      "categories": [
        "seeds"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "clarity",
      "tags": [
        "Seed",
        "Berry",
        "Implied"
      ]
    },
    "blackberrySeeds": {
      "id": "blackberrySeeds",
      "name": "Blackberry Seeds",
      "categories": [
        "seeds"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "speed",
      "tags": [
        "Seed",
        "Berry",
        "Implied"
      ]
    },
    "blackMustardSeed": {
      "id": "blackMustardSeed",
      "name": "Black Mustard Seed",
      "categories": [
        "mustardSeed",
        "seeds",
        "spice"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "combat",
      "tags": [
        "Mustard",
        "Hot",
        "Seed",
        "Raw"
      ]
    },
    "greenMustardSeed": {
      "id": "greenMustardSeed",
      "name": "Green Mustard Seed",
      "categories": [
        "mustardSeed",
        "seeds",
        "spice"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "foraging",
      "tags": [
        "Mustard",
        "Fresh",
        "Seed",
        "Raw"
      ]
    },
    "blackMustardPaste": {
      "id": "blackMustardPaste",
      "name": "Black Mustard Paste",
      "categories": [
        "pungentPaste",
        "spice",
        "sauce"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "crafting",
      "tags": [
        "Mustard",
        "Hot",
        "Processed",
        "Pungent Paste"
      ]
    },
    "greenMustardPaste": {
      "id": "greenMustardPaste",
      "name": "Green Mustard Paste",
      "categories": [
        "pungentPaste",
        "spice",
        "sauce"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "crafting",
      "tags": [
        "Mustard",
        "Fresh",
        "Processed",
        "Pungent Paste"
      ]
    },
    "needlegrainFlour": {
      "id": "needlegrainFlour",
      "name": "Needlegrain Flour",
      "categories": [
        "flour",
        "processedCrop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "crafting",
      "tags": [
        "Flour",
        "Needlegrain",
        "Partially Processed"
      ]
    },
    "heftrootFlour": {
      "id": "heftrootFlour",
      "name": "Heftroot Flour",
      "categories": [
        "flour",
        "processedCrop"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "crafting",
      "tags": [
        "Flour",
        "Heftroot",
        "Ground Root"
      ]
    },
    "greenBread": {
      "id": "greenBread",
      "name": "Green Bread",
      "categories": [
        "bread",
        "processedCrop",
        "starchVegetable"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "fortitude",
      "tags": [
        "Needlegrain",
        "Bread"
      ]
    },
    "yellowBread": {
      "id": "yellowBread",
      "name": "Yellow Bread",
      "categories": [
        "bread",
        "processedCrop",
        "starchVegetable"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "fortitude",
      "tags": [
        "Heftroot",
        "Bread"
      ]
    },
    "redberryJam": {
      "id": "redberryJam",
      "name": "Redberry Jam",
      "categories": [
        "sweetPaste",
        "fruit"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "fortitude",
      "tags": [
        "Fruit",
        "Preserve"
      ]
    },
    "blueberryJam": {
      "id": "blueberryJam",
      "name": "Blueberry Jam",
      "categories": [
        "sweetPaste",
        "fruit"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "vigor",
      "tags": [
        "Fruit",
        "Preserve",
        "Implied"
      ]
    },
    "yellowberryJam": {
      "id": "yellowberryJam",
      "name": "Yellowberry Jam",
      "categories": [
        "sweetPaste",
        "fruit"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "fortitude",
      "tags": [
        "Fruit",
        "Preserve",
        "Implied"
      ]
    },
    "whiteberryJelly": {
      "id": "whiteberryJelly",
      "name": "Whiteberry Jelly",
      "categories": [
        "sweetPaste",
        "fruit"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "clarity",
      "tags": [
        "Fruit",
        "Mild",
        "Preserve"
      ]
    },
    "blackberryJam": {
      "id": "blackberryJam",
      "name": "Blackberry Jam",
      "categories": [
        "sweetPaste",
        "fruit"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "speed",
      "tags": [
        "Fruit",
        "Preserve",
        "Implied"
      ]
    },
    "mixedBerryJam": {
      "id": "mixedBerryJam",
      "name": "Mixed Berry Jam",
      "categories": [
        "sweetPaste",
        "fruit"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "clarity",
      "tags": [
        "Fruit",
        "Preserve",
        "Implied"
      ]
    },
    "puktukMilk": {
      "id": "puktukMilk",
      "name": "Puktuk Milk",
      "categories": [
        "whiteMilk",
        "dairy"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fortitude",
      "tags": [
        "Milk",
        "Puktuk",
        "Live-Birth Animal"
      ]
    },
    "voorgAssMilk": {
      "id": "voorgAssMilk",
      "name": "Voorg-Ass Milk",
      "categories": [
        "whiteMilk",
        "dairy"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "speed",
      "tags": [
        "Milk",
        "Voorg-Ass"
      ]
    },
    "uumkaoiiCheese": {
      "id": "uumkaoiiCheese",
      "name": "Uumkao’ii Cheese",
      "categories": [
        "cheese",
        "uumkaoiiCheese"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "long",
      "primaryEffect": "farming",
      "tags": [
        "Cheese",
        "Uumkao’ii",
        "Dew Curd",
        "Vase-Fermented",
        "Anaerobic",
        "Not Dairy"
      ]
    },
    "uumkaoiiButter": {
      "id": "uumkaoiiButter",
      "name": "Uumkao’ii Butter",
      "categories": [
        "butter"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "farming",
      "tags": [
        "Butter",
        "Uumkao’ii",
        "Not Dairy"
      ]
    },
    "nelkEggs": {
      "id": "nelkEggs",
      "name": "Nelk Eggs",
      "categories": [
        "egg"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "strength",
      "tags": [
        "Egg",
        "Nelk"
      ]
    },
    "nelkMayonnaise": {
      "id": "nelkMayonnaise",
      "name": "Nelk Mayonnaise",
      "categories": [
        "mayonnaise",
        "sauce"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "farming",
      "tags": [
        "Egg",
        "Sauce",
        "Nelk"
      ]
    },
    "uumkaoiiEggs": {
      "id": "uumkaoiiEggs",
      "name": "Uumkao’ii Eggs",
      "categories": [
        "egg"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "vigor",
      "tags": [
        "Egg",
        "Uumkao’ii"
      ]
    },
    "uumkaoiiMayonnaise": {
      "id": "uumkaoiiMayonnaise",
      "name": "Uumkao’ii Mayonnaise",
      "categories": [
        "mayonnaise",
        "sauce"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "farming",
      "tags": [
        "Egg",
        "Sauce",
        "Uumkao’ii"
      ]
    },
    "nazgrakuEggs": {
      "id": "nazgrakuEggs",
      "name": "Nazgraku Eggs",
      "categories": [
        "egg"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "combat",
      "tags": [
        "Egg",
        "Nazgraku"
      ]
    },
    "nazgrakuMayonnaise": {
      "id": "nazgrakuMayonnaise",
      "name": "Nazgraku Mayonnaise",
      "categories": [
        "mayonnaise",
        "sauce"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "farming",
      "tags": [
        "Egg",
        "Sauce",
        "Nazgraku"
      ]
    },
    "drenkirraEggs": {
      "id": "drenkirraEggs",
      "name": "Drenkirra Eggs",
      "categories": [
        "egg"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "speed",
      "tags": [
        "Egg",
        "Drenkirra"
      ]
    },
    "drenkirraMayonnaise": {
      "id": "drenkirraMayonnaise",
      "name": "Drenkirra Mayonnaise",
      "categories": [
        "mayonnaise",
        "sauce"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "farming",
      "tags": [
        "Egg",
        "Sauce",
        "Drenkirra"
      ]
    },
    "puktukWool": {
      "id": "puktukWool",
      "name": "Puktuk Wool",
      "categories": [
        "wool",
        "material"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fortitude",
      "tags": [
        "Animal Product",
        "Non-Cooking"
      ]
    },
    "puktukMeat": {
      "id": "puktukMeat",
      "name": "Puktuk Meat",
      "categories": [
        "meat"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "strength",
      "tags": [
        "Meat",
        "Puktuk"
      ]
    },
    "nelkMeat": {
      "id": "nelkMeat",
      "name": "Nelk Meat",
      "categories": [
        "poultry",
        "meat"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "strength",
      "tags": [
        "Poultry",
        "Meat",
        "Nelk"
      ]
    },
    "uumkaoiiMeat": {
      "id": "uumkaoiiMeat",
      "name": "Uumkao’ii Meat",
      "categories": [
        "meat"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "strength",
      "tags": [
        "Meat",
        "Uumkao’ii"
      ]
    },
    "nazgrakuMeat": {
      "id": "nazgrakuMeat",
      "name": "Nazgraku Meat",
      "categories": [
        "poultry",
        "meat"
      ],
      "quality": 3,
      "baseBoost": 2,
      "processingTier": "raw",
      "primaryEffect": "combat",
      "tags": [
        "Poultry",
        "Meat",
        "Nazgraku"
      ]
    },
    "drenkirraMeat": {
      "id": "drenkirraMeat",
      "name": "Drenkirra Meat",
      "categories": [
        "poultry",
        "meat"
      ],
      "quality": 2,
      "baseBoost": 2,
      "processingTier": "raw",
      "primaryEffect": "speed",
      "tags": [
        "Poultry",
        "Meat",
        "Drenkirra"
      ]
    },
    "grehlrMeat": {
      "id": "grehlrMeat",
      "name": "Grehlr Meat",
      "categories": [
        "meat"
      ],
      "quality": 2,
      "baseBoost": 3,
      "processingTier": "raw",
      "primaryEffect": "fortitude",
      "tags": [
        "Meat",
        "Grehlr"
      ]
    },
    "denaturedStinkOil": {
      "id": "denaturedStinkOil",
      "name": "Denatured Stink Oil",
      "categories": [
        "pungentPaste",
        "spice",
        "sauce"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "fortitude",
      "tags": [
        "Grehlr",
        "Processed",
        "Pungent Paste"
      ]
    },
    "voorgAssMeat": {
      "id": "voorgAssMeat",
      "name": "Voorg-Ass Meat",
      "categories": [
        "meat"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "speed",
      "tags": [
        "Meat",
        "Voorg-Ass"
      ]
    },
    "smokedMeat": {
      "id": "smokedMeat",
      "name": "Smoked Meat",
      "categories": [
        "meat"
      ],
      "quality": 3,
      "baseBoost": 2,
      "processingTier": "medium",
      "primaryEffect": "strength",
      "tags": [
        "Meat",
        "Processed",
        "Generic"
      ]
    },
    "riverFish": {
      "id": "riverFish",
      "name": "Northern River Fish",
      "categories": [
        "fish"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fishing",
      "tags": [
        "Fish"
      ]
    },
    "cloudFish": {
      "id": "cloudFish",
      "name": "Cloud-Flood Fish",
      "categories": [
        "fish"
      ],
      "quality": 3,
      "baseBoost": 2,
      "processingTier": "raw",
      "primaryEffect": "fishing",
      "tags": [
        "Fish",
        "Cloud-Flood",
        "Made-Up"
      ]
    },
    "cliffMollusk": {
      "id": "cliffMollusk",
      "name": "Cliff Mollusk",
      "categories": [
        "mollusk"
      ],
      "quality": 3,
      "baseBoost": 2,
      "processingTier": "raw",
      "primaryEffect": "mining",
      "tags": [
        "Mollusk"
      ]
    },
    "fishSauce": {
      "id": "fishSauce",
      "name": "Fish Sauce",
      "categories": [
        "sauce",
        "spice",
        "brothBase"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "medium",
      "primaryEffect": "speed",
      "tags": [
        "Fish",
        "Sauce",
        "Processed"
      ]
    },
    "localNuts": {
      "id": "localNuts",
      "name": "Local Nuts",
      "categories": [
        "nut",
        "seeds"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fortitude",
      "tags": [
        "Nut",
        "Implied"
      ]
    },
    "nutOil": {
      "id": "nutOil",
      "name": "Nut Oil",
      "categories": [
        "oil",
        "butter"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "crafting",
      "tags": [
        "Nut",
        "Oil",
        "Processed"
      ]
    },
    "nutButter": {
      "id": "nutButter",
      "name": "Nut Butter",
      "categories": [
        "butter",
        "nut"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "quick",
      "primaryEffect": "crafting",
      "tags": [
        "Nut",
        "Butter",
        "Processed"
      ]
    },
    "travelSpice": {
      "id": "travelSpice",
      "name": "Trader-Sloth Spice",
      "categories": [
        "spice"
      ],
      "quality": 3,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "fortitude",
      "tags": [
        "Imported",
        "Spice"
      ]
    },
    "cloudHerbs": {
      "id": "cloudHerbs",
      "name": "Cloud Herbs",
      "categories": [
        "herb",
        "spice"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "vigor",
      "tags": [
        "Herb",
        "Cloud Forest",
        "Implied"
      ]
    },
    "mireHerbs": {
      "id": "mireHerbs",
      "name": "Mire Herbs",
      "categories": [
        "herb",
        "spice"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "speed",
      "tags": [
        "Herb",
        "Mire",
        "Implied"
      ]
    },
    "drySeasonSpice": {
      "id": "drySeasonSpice",
      "name": "Dry-Season Spice",
      "categories": [
        "spice"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "combat",
      "tags": [
        "Local Spice",
        "Dry Season",
        "Implied"
      ]
    },
    "impureCopper": {
      "id": "impureCopper",
      "name": "Impure Copper",
      "categories": [
        "mineral",
        "material"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "mining",
      "tags": [
        "Mineral",
        "Non-Cooking"
      ]
    },
    "arsenic": {
      "id": "arsenic",
      "name": "Arsenic",
      "categories": [
        "mineral",
        "material"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "perception",
      "tags": [
        "Mineral",
        "Hazard",
        "Non-Cooking"
      ]
    },
    "zinc": {
      "id": "zinc",
      "name": "Zinc",
      "categories": [
        "mineral",
        "material"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "mining",
      "tags": [
        "Mineral",
        "Non-Cooking"
      ]
    },
    "roughTin": {
      "id": "roughTin",
      "name": "Rough Tin",
      "categories": [
        "mineral",
        "material"
      ],
      "quality": 1,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "mining",
      "tags": [
        "Mineral",
        "Non-Cooking"
      ]
    },
    "caveGlass": {
      "id": "caveGlass",
      "name": "Cave Glass",
      "categories": [
        "mineral",
        "material"
      ],
      "quality": 2,
      "baseBoost": 1,
      "processingTier": "raw",
      "primaryEffect": "mining",
      "tags": [
        "Mineral",
        "Non-Cooking"
      ]
    }
  },
  "recipes": [
    {
      "id": "sweetGoopyMustardSauce",
      "name": "Sweet Goopy Mustard Sauce",
      "description": "A sticky local sauce. Sweet paste + mayonnaise + pungent paste.",
      "baseOutputName": "Sweet Goopy Mustard Sauce",
      "slots": [
        {
          "id": "sweetPaste",
          "label": "Sweet Paste",
          "accepts": [
            "sweetPaste"
          ],
          "required": true
        },
        {
          "id": "mayo",
          "label": "Mayonnaise",
          "accepts": [
            "mayonnaise"
          ],
          "required": true
        },
        {
          "id": "pungentPaste",
          "label": "Pungent Paste",
          "accepts": [
            "pungentPaste"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Sauce",
        "Gift",
        "Cooking Ingredient"
      ]
    },
    {
      "id": "basicNoodles",
      "name": "Basic Noodles",
      "description": "Simple egg noodles made from flour and eggs. Heftroot flour cooks into yellow noodles; other flours use a neutral noodle base name for now.",
      "baseOutputName": "Basic Noodles",
      "slots": [
        {
          "id": "flour",
          "label": "Flour",
          "accepts": [
            "flour"
          ],
          "required": true
        },
        {
          "id": "egg",
          "label": "Egg",
          "accepts": [
            "egg"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Cooking Ingredient",
        "Noodles"
      ],
      "inventoryCategories": [
        "noodleBase",
        "processedCrop"
      ]
    },
    {
      "id": "mayonnaise",
      "name": "Mayonnaise",
      "description": "Eggs emulsified with oil at the hearth. The egg species determines the mayonnaise name and effects.",
      "baseOutputName": "Mayonnaise",
      "slots": [
        {
          "id": "egg",
          "label": "Egg",
          "accepts": [
            "egg"
          ],
          "required": true
        },
        {
          "id": "oil",
          "label": "Oil",
          "accepts": [
            "oil"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Cooking Ingredient",
        "Mayonnaise",
        "Sauce"
      ],
      "inventoryCategories": [
        "mayonnaise",
        "sauce"
      ]
    },
    {
      "id": "bread",
      "name": "Bread",
      "description": "A hearth-baked loaf made from flour. Oil or butter is optional for a richer loaf.",
      "baseOutputName": "Bread",
      "slots": [
        {
          "id": "flour",
          "label": "Flour",
          "accepts": [
            "flour"
          ],
          "required": true
        },
        {
          "id": "fat",
          "label": "Oil / Butter (Optional)",
          "accepts": [
            "oil",
            "butter"
          ],
          "required": false
        }
      ],
      "outputTags": [
        "Cooking Ingredient",
        "Bread",
        "Baked"
      ],
      "inventoryCategories": [
        "bread",
        "processedCrop",
        "starchVegetable"
      ]
    },
    {
      "id": "spicyNoodles",
      "name": "Spicy Noodles",
      "description": "Noodles with heat. Quality leans on spice and noodle base.",
      "baseOutputName": "Spicy Noodles",
      "slots": [
        {
          "id": "noodles",
          "label": "Noodles",
          "accepts": [
            "noodleBase"
          ],
          "required": true
        },
        {
          "id": "spice",
          "label": "Spice",
          "accepts": [
            "spice"
          ],
          "required": true
        },
        {
          "id": "veg",
          "label": "Vegetable",
          "accepts": [
            "vegetable"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Warm"
      ]
    },
    {
      "id": "cheesyNoodles",
      "name": "Cheesy Noodles",
      "description": "Comfort food made from noodles and cheese.",
      "baseOutputName": "Cheesy Noodles",
      "slots": [
        {
          "id": "noodles",
          "label": "Noodles",
          "accepts": [
            "noodleBase"
          ],
          "required": true
        },
        {
          "id": "cheese",
          "label": "Cheese",
          "accepts": [
            "cheese"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Comfort"
      ]
    },
    {
      "id": "poultrySoup",
      "name": "Poultry Soup",
      "description": "A flexible soup using poultry, aromatic vegetables, and a broth base.",
      "baseOutputName": "Poultry Soup",
      "slots": [
        {
          "id": "poultry",
          "label": "Poultry",
          "accepts": [
            "poultry"
          ],
          "required": true
        },
        {
          "id": "broth",
          "label": "Broth Base",
          "accepts": [
            "brothBase",
            "vegetable"
          ],
          "required": true
        },
        {
          "id": "spice",
          "label": "Spice",
          "accepts": [
            "spice"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Soup"
      ]
    },
    {
      "id": "meatStew",
      "name": "Meat Stew",
      "description": "Dense stew built from meat, a root/starch vegetable, and vegetable flavor.",
      "baseOutputName": "Meat Stew",
      "slots": [
        {
          "id": "meat",
          "label": "Meat",
          "accepts": [
            "meat"
          ],
          "required": true
        },
        {
          "id": "starch",
          "label": "Root / Starch Vegetable",
          "accepts": [
            "starchVegetable"
          ],
          "disallowCategories": [
            "grain",
            "flour"
          ],
          "required": true
        },
        {
          "id": "veg",
          "label": "Vegetable",
          "accepts": [
            "vegetable"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Heavy"
      ]
    },
    {
      "id": "poultryGrainChowder",
      "name": "Poultry Grain Chowder",
      "description": "1 white milk, 1 grain, 1 poultry, 1 spice.",
      "baseOutputName": "Poultry Grain Chowder",
      "slots": [
        {
          "id": "milk",
          "label": "White Milk",
          "accepts": [
            "whiteMilk"
          ],
          "required": true
        },
        {
          "id": "grain",
          "label": "Grain",
          "accepts": [
            "grain"
          ],
          "required": true
        },
        {
          "id": "poultry",
          "label": "Poultry",
          "accepts": [
            "poultry"
          ],
          "required": true
        },
        {
          "id": "spice",
          "label": "Spice",
          "accepts": [
            "spice"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Chowder"
      ]
    },
    {
      "id": "fishChowder",
      "name": "Fish Chowder",
      "description": "1 white milk, 1 root/starch vegetable, 1 fish/mollusk, 1 butter.",
      "baseOutputName": "Fish Chowder",
      "slots": [
        {
          "id": "milk",
          "label": "White Milk",
          "accepts": [
            "whiteMilk"
          ],
          "required": true
        },
        {
          "id": "starch",
          "label": "Root / Starch Vegetable",
          "accepts": [
            "starchVegetable"
          ],
          "disallowCategories": [
            "grain",
            "flour"
          ],
          "required": true
        },
        {
          "id": "fish",
          "label": "Fish / Mollusk",
          "accepts": [
            "fish",
            "mollusk"
          ],
          "required": true
        },
        {
          "id": "butter",
          "label": "Butter",
          "accepts": [
            "butter"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Chowder"
      ]
    },
    {
      "id": "gardenOmelet",
      "name": "Garden Omelet",
      "description": "Eggs, cheese, and vegetables. Basically a flexible farm omelet.",
      "baseOutputName": "Garden Omelet",
      "slots": [
        {
          "id": "egg",
          "label": "Egg",
          "accepts": [
            "egg"
          ],
          "required": true
        },
        {
          "id": "cheese",
          "label": "Cheese",
          "accepts": [
            "cheese"
          ],
          "required": true
        },
        {
          "id": "veg",
          "label": "Vegetable",
          "accepts": [
            "vegetable"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Breakfast"
      ]
    },
    {
      "id": "grainScramble",
      "name": "Grain Scramble",
      "description": "1 grain, 1 egg, 1 vegetable. A loose fried-rice / corn-and-egg style template.",
      "baseOutputName": "Grain Scramble",
      "slots": [
        {
          "id": "grain",
          "label": "Grain",
          "accepts": [
            "grain"
          ],
          "required": true
        },
        {
          "id": "egg",
          "label": "Egg",
          "accepts": [
            "egg"
          ],
          "required": true
        },
        {
          "id": "veg",
          "label": "Vegetable",
          "accepts": [
            "vegetable"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Skillet"
      ]
    },
    {
      "id": "fishNoodles",
      "name": "Fish Noodles",
      "description": "1 noodles, 1 fish/mollusk, 1 broth base. A seafood noodle soup template.",
      "baseOutputName": "Fish Noodles",
      "slots": [
        {
          "id": "noodles",
          "label": "Noodles",
          "accepts": [
            "noodleBase"
          ],
          "required": true
        },
        {
          "id": "fish",
          "label": "Fish / Mollusk",
          "accepts": [
            "fish",
            "mollusk"
          ],
          "required": true
        },
        {
          "id": "broth",
          "label": "Broth Base",
          "accepts": [
            "brothBase"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Noodles",
        "Soup"
      ]
    },
    {
      "id": "meatNoodles",
      "name": "Meat Noodles",
      "description": "1 noodles, 1 meat, 1 spice/pungent paste. Named as <spice> <meat> and <noodles>.",
      "baseOutputName": "Meat Noodles",
      "slots": [
        {
          "id": "noodles",
          "label": "Noodles",
          "accepts": [
            "noodleBase"
          ],
          "required": true
        },
        {
          "id": "meat",
          "label": "Meat",
          "accepts": [
            "meat"
          ],
          "required": true
        },
        {
          "id": "seasoning",
          "label": "Spice / Pungent Paste",
          "accepts": [
            "spice",
            "pungentPaste"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Noodles"
      ]
    },
    {
      "id": "breakfastPorridge",
      "name": "Breakfast Porridge",
      "description": "1 grain, 1 sweet liquid/white milk, 1 sweet paste. An oatmeal/rice-pudding style template.",
      "baseOutputName": "Breakfast Porridge",
      "slots": [
        {
          "id": "grain",
          "label": "Grain",
          "accepts": [
            "grain"
          ],
          "required": true
        },
        {
          "id": "liquid",
          "label": "Sweet Liquid / White Milk",
          "accepts": [
            "sweetLiquid",
            "whiteMilk"
          ],
          "required": true
        },
        {
          "id": "sweetPaste",
          "label": "Sweet Paste",
          "accepts": [
            "sweetPaste"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Breakfast",
        "Sweet"
      ]
    },
    {
      "id": "fruitPie",
      "name": "Fruit Pie",
      "description": "1 flour, 1 fruit, 1 sweet paste. A lazy pie template for any fruit filling.",
      "baseOutputName": "Fruit Pie",
      "slots": [
        {
          "id": "flour",
          "label": "Flour",
          "accepts": [
            "flour"
          ],
          "required": true
        },
        {
          "id": "fruit",
          "label": "Fruit",
          "accepts": [
            "fruit"
          ],
          "required": true
        },
        {
          "id": "sweetPaste",
          "label": "Sweet Paste",
          "accepts": [
            "sweetPaste"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Dessert",
        "Baked"
      ]
    },
    {
      "id": "meatPie",
      "name": "Meat Pie",
      "description": "1 flour, 1 meat, 1 vegetable. A minimalist savory pie / pasty template.",
      "baseOutputName": "Meat Pie",
      "slots": [
        {
          "id": "flour",
          "label": "Flour",
          "accepts": [
            "flour"
          ],
          "required": true
        },
        {
          "id": "meat",
          "label": "Meat",
          "accepts": [
            "meat"
          ],
          "required": true
        },
        {
          "id": "veg",
          "label": "Vegetable",
          "accepts": [
            "vegetable"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Baked",
        "Heavy"
      ]
    },
    {
      "id": "cheeseStarchSoup",
      "name": "Cheese Starch Soup",
      "description": "1 white milk, 1 cheese, 1 root/starch vegetable. Basically potato cheese soup, opened up.",
      "baseOutputName": "Cheese Starch Soup",
      "slots": [
        {
          "id": "milk",
          "label": "White Milk",
          "accepts": [
            "whiteMilk"
          ],
          "required": true
        },
        {
          "id": "cheese",
          "label": "Cheese",
          "accepts": [
            "cheese"
          ],
          "required": true
        },
        {
          "id": "starch",
          "label": "Root / Starch Vegetable",
          "accepts": [
            "starchVegetable"
          ],
          "disallowCategories": [
            "grain",
            "flour"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Soup",
        "Comfort"
      ]
    },
    {
      "id": "friedFish",
      "name": "Fried Fish",
      "description": "1 fish/mollusk, 1 flour, 1 oil/butter. A simple battered-fish template.",
      "baseOutputName": "Fried Fish",
      "slots": [
        {
          "id": "fish",
          "label": "Fish / Mollusk",
          "accepts": [
            "fish",
            "mollusk"
          ],
          "required": true
        },
        {
          "id": "flour",
          "label": "Flour",
          "accepts": [
            "flour"
          ],
          "required": true
        },
        {
          "id": "fat",
          "label": "Oil / Butter",
          "accepts": [
            "oil",
            "butter"
          ],
          "required": true
        }
      ],
      "outputTags": [
        "Meal",
        "Fried"
      ]
    }
  ],
  "identityNameRules": {
    "sweetGoopyMustardSauce": {
      "pattern": "{sweetPaste} {pungentPaste} Sauce",
      "namedSlots": [
        "sweetPaste",
        "pungentPaste"
      ]
    },
    "basicNoodles": {
      "pattern": "{flour} Noodles",
      "namedSlots": [
        "flour"
      ]
    },
    "mayonnaise": {
      "pattern": "{egg} Mayonnaise",
      "namedSlots": [
        "egg"
      ]
    },
    "bread": {
      "pattern": "{flour} Bread",
      "namedSlots": [
        "flour"
      ]
    },
    "spicyNoodles": {
      "pattern": "{spice} Noodles",
      "namedSlots": [
        "spice"
      ]
    },
    "cheesyNoodles": {
      "pattern": "{cheese} Noodles",
      "namedSlots": [
        "cheese"
      ]
    },
    "poultrySoup": {
      "pattern": "{poultry} Soup",
      "namedSlots": [
        "poultry"
      ]
    },
    "meatStew": {
      "pattern": "{meat} {starch} Stew",
      "namedSlots": [
        "meat",
        "starch"
      ]
    },
    "poultryGrainChowder": {
      "pattern": "{poultry} {grain} Chowder",
      "namedSlots": [
        "poultry",
        "grain"
      ]
    },
    "fishChowder": {
      "pattern": "{fish} Chowder",
      "namedSlots": [
        "fish"
      ]
    },
    "gardenOmelet": {
      "pattern": "{veg} {cheese} Omelet",
      "namedSlots": [
        "veg",
        "cheese"
      ]
    },
    "grainScramble": {
      "pattern": "{grain} {veg} Scramble",
      "namedSlots": [
        "grain",
        "veg"
      ]
    },
    "fishNoodles": {
      "pattern": "{fish} Noodle Soup",
      "namedSlots": [
        "fish"
      ]
    },
    "meatNoodles": {
      "pattern": "{seasoning} {meat} and {noodles}",
      "namedSlots": [
        "seasoning",
        "meat",
        "noodles"
      ]
    },
    "breakfastPorridge": {
      "pattern": "{sweetPaste} {grain} Porridge",
      "namedSlots": [
        "sweetPaste",
        "grain"
      ]
    },
    "fruitPie": {
      "pattern": "{fruit} Pie",
      "namedSlots": [
        "fruit"
      ]
    },
    "meatPie": {
      "pattern": "{meat} {veg} Pie",
      "namedSlots": [
        "meat",
        "veg"
      ]
    },
    "cheeseStarchSoup": {
      "pattern": "{starch} {cheese} Soup",
      "namedSlots": [
        "starch",
        "cheese"
      ]
    },
    "friedFish": {
      "pattern": "{fish} Fry",
      "namedSlots": [
        "fish"
      ]
    }
  },
  "itemNameTokenOverrides": {
    "yellowDew": "Yellow Dew",
    "greenDew": "Green Dew",
    "blueDew": "Blue Dew",
    "orangeDew": "Orange Dew",
    "redDew": "Red Dew",
    "purpleDew": "Purple Dew",
    "whiteDew": "White Dew",
    "yellowDewCurds": "Yellow Curd",
    "greenDewCurds": "Green Curd",
    "blueDewCurds": "Blue Curd",
    "orangeDewCurds": "Orange Curd",
    "redDewCurds": "Red Curd",
    "purpleDewCurds": "Purple Curd",
    "uumkaoiiWhiteDewCurds": "White Curd",
    "ongyums": "Ongyum",
    "grassSeeds": "Grass Seed",
    "redberryJam": "Redberry",
    "blueberryJam": "Blueberry",
    "yellowberryJam": "Yellowberry",
    "whiteberryJelly": "Whiteberry",
    "blackberryJam": "Blackberry",
    "mixedBerryJam": "Mixed Berry",
    "blackMustardPaste": "Black Mustard",
    "greenMustardPaste": "Green Mustard",
    "denaturedStinkOil": "Stink Oil",
    "demoPlainNoodles": "Plain Noodles",
    "needlegrainFlour": "Needlegrain",
    "heftrootFlour": "Heftroot",
    "nelkEggs": "Nelk",
    "uumkaoiiEgg": "Uumkao’ii",
    "nazgrakuEggs": "Nazgraku",
    "drenkirraEgg": "Drenkirra",
    "blackMustardSeed": "Black Mustard",
    "greenMustardSeed": "Green Mustard",
    "travelSpice": "Trader-Sloth",
    "cloudHerbs": "Cloud Herb",
    "mireHerbs": "Mire Herb",
    "drySeasonSpice": "Dry-Season",
    "puktukMeat": "Puktuk",
    "nelkMeat": "Nelk",
    "uumkaoiiMeat": "Uumkao’ii",
    "nazgrakuMeat": "Nazgraku",
    "drenkirraMeat": "Drenkirra",
    "grehlrMeat": "Grehlr",
    "voorgAssMeat": "Voorg-Ass",
    "smokedMeat": "Smoked Meat",
    "riverFish": "Northern River Fish",
    "cloudFish": "Cloud-Flood Fish",
    "cliffMollusk": "Cliff Mollusk",
    "redberries": "Redberry",
    "blueberries": "Blueberry",
    "yellowberries": "Yellowberry",
    "whiteberries": "Whiteberry",
    "blackberries": "Blackberry",
    "localNuts": "Local Nut"
  }
};
})();
