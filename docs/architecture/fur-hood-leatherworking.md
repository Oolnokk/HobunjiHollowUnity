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

The same expressed genetic motifs and inherited ink colors are applied to `furhood-base`, `<animal>-front`, and `<animal>-back` sprites. They do not recolor `furhood-trim`. Player-authored base weaving also runs above the inherited markings on every hide-derived piece; the portrait resolver registers the dynamic animal sprite URLs for the currently rendered wearer so these effects match the loom preview and do not leak across characters.

The manifest's `patterns[geneId] = {motifPng,settings}` is dev-authored geometry/placement only. At render time `FurHoodLeatherworking.markingsFor` checks whether the saved hide expresses each gene, reads the color from `genotype[geneId].color`, and produces independent motif/color passes on the base layer before optional player `weaving` motifs. Animal motifs do **not** occupy either normal player weaving slot and are not saved in a garment's `weaving` field.

### Paint directly on the hood (developer tool)

In **Tool Hub → Pattern Editor → Animal fur-hood markings**, select the hide species, exact gene ID, head-fit variant, and Front/Behind. Press **Paint directly on hood…**. Paint and erase on the real hood sprite, with touch-friendly zoom/pan, undo/redo, and individual pixel brushes. Only the fur-eligible substrate (hood base and species-specific front/back pieces) is writable; the decorative trim is excluded. The editor shows a separate **Actual in-game result** preview produced by the production clothing/genotype compositor, including the normal colored motif and black outline.

The author can control the ordinary weaving mesh **scale, rotation, X/Y offsets, X/Y stretch, and flips**. A shared inverse canvas transform converts the garment-space strokes into a **regular non-tiling motif PNG**. The runtime still consumes the standard `{ motifPng, settings }` record; no painted garment mask or new weaving slot is required for game logic. A narrowly scoped `garmentFixed: true` setting keeps the ordinary non-tiling pattern's source-frame center independent of ink bounds and disables the unrelated per-cell weave staggering. Because the same code supplies the inverse transformation and runtime mask projection, editing the pattern does not silently recenter it. The generated motif canvas expands to retain brush strokes even with rotation, offsets, or reduced scale; extreme projections are rejected with a visible error rather than cropped.

Press **Save motif** inside the paint overlay, then export **New animal motif PNGs** and **fur-hoods.json** from the existing authoring panel. Editor-only `authoring: { mode: 'hood-paint', width, height, view, operations, maskRle }` is saved under each species/gene manifest entry so the drawing can be reopened exactly, even after a clear or erase; it is ignored by the game. Switching to a different view can reproject the existing exported motif onto that hood, so you do not need to redraw it from scratch. This is still **one motif per animal gene** applied to all eligible fur pieces and wearer fits, not a separate pattern per view/head fit.

Transient brush previews use the ordinary compositor without inserting each temporary motif PNG into persistent sprite caches. For verification, run the dedicated regression test as well as the original fur-hood test:

```sh
node scripts/test-fur-hood-direct-paint.js
node scripts/test-fur-hood-leatherworking.js
```

**Known authoring prerequisite:** No actual genotype motif PNGs were uploaded as part of the hood-sprite batches. The shipped manifest's `patterns` entries are empty until the dev exports those motifs; the hood still shows the accurate base coat and real animal head/trophy sprites.

## Quick verification

```sh
node scripts/test-fur-hood-leatherworking.js
```

The test checks the exact authored art filenames, manifest paths, genetic hue and allele persistence, nearest head-variant fallback, and the separation of natural/personal weaving data. The game also exposes `window.FurHoodLeatherworking.debugSnapshot()` and the normal ClothingWeavingSystem debug snapshot for mobile troubleshooting.
