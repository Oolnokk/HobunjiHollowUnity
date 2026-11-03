# Natural fur-hood leatherworking

The fur-hood implementation intentionally reuses the game’s existing item, dye, portrait, and pattern systems rather than making a second wardrobe. It is available from **Simple Loom / Advanced Loom → Leatherworking** (including when no cloth blueprints or dyes have been learned).

## Item and provenance

- `AnimalHides.groupsFor()` lists individual hide variants with complete immutable genotype records and base-coat colors. Legacy hides without genotype are ineligible rather than given a randomly invented coat.
- Crafting chooses one exact `hide:...` variant, calls `AnimalHides.consume(...,'pack',variant)`, decrements the count inventory and saves the world member.
- Each crafted `fur_hood` article owns `furHood: {kind, sourceKind, sourceItemKey, genotype, appearance, baseColor, hideStars}`, distinct from regular `weaving`. Pack-to-Gear migration copies this object without dropping genome data, and individual articles stay distinct even without custom patterns.
- Base and trim receive the preserved natural coat hue and are never re-dyed. Reweaving only changes the optional conventional pattern(s) and their Dye C color. An Advanced Loom can author a standard second overpass pattern.

## Sprite source and layering

The verified uploaded art lives in `docs/assets/cosmetics/clothes/hood/`. The `fur_hood` cosmetic uses `furhood-base_tl_m.png`, `furhood-trim_tl_m.png`, `furhood-base_mashtz_m.png`, and `furhood-trim_mashtz_m.png`. These two head-shape variants cover playable genders/species through the existing head-cosmetic fallback chain.

`docs/config/patterns/fur-hoods.json` records optional per-animal, **per-wearer-variant** front/back art, e.g. `species["gar-wolf"].parts["tletingan_male"].front`. `front` is drawn between fur-hood base and trim. `back` is drawn behind the wearer's skull; adding an animal back does not erase the hood's front/base when no separate base rear sprite is authored.

The manifest currently references the uploaded Gar-wolf, Grehlr, Drenkirra, Nelk, Puktuk and Voorg-ass parts that actually exist, with missing front/back sides omitted rather than guessed.

## Authoring natural gene markings

In **Tool Hub → Pattern Editor → Animal fur-hood markings**, select the animal species, wearer head fit, and **exact genotype pattern id**. Edit the ordinary motif in the Pattern Editor, assign it to the animal gene, and export **both** its PNG (to `docs/assets/patterns/fur-hoods/`) and `fur-hoods.json` (to `docs/config/patterns/`). Paths for special front/back sprites can also be edited there independently for the two wearer fits. These exports need committing to the repository before they become playable defaults.

The manifest's `patterns[geneId] = {motifPng,settings}` is dev-authored geometry/placement only. At render time `FurHoodLeatherworking.markingsFor` checks whether the saved hide expresses each gene, reads the color from `genotype[geneId].color`, and produces independent motif/color passes on the base layer before optional player `weaving` motifs. Animal motifs do **not** occupy either normal player weaving slot and are not saved in a garment's `weaving` field.

**Known authoring prerequisite:** No actual genotype motif PNGs were uploaded as part of the hood-sprite batches. The shipped manifest's `patterns` entries are empty until the dev exports those motifs; the hood still shows the accurate base coat and real animal head/trophy sprites.

## Quick verification

```sh
node scripts/test-fur-hood-leatherworking.js
```

The test checks the exact authored art filenames, manifest paths, genetic hue and allele persistence, nearest head-variant fallback, and the separation of natural/personal weaving data. The game also exposes `window.FurHoodLeatherworking.debugSnapshot()` and the normal ClothingWeavingSystem debug snapshot for mobile troubleshooting.
