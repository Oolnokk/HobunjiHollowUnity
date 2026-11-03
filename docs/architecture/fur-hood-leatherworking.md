# Natural fur-hood leatherworking

The fur-hood implementation intentionally reuses the game’s existing item, dye, portrait, and pattern systems rather than making a second wardrobe. It is available from **Simple Loom / Advanced Loom → Leatherworking** (including when no cloth blueprints or dyes have been learned).

## Item and provenance

- `AnimalHides.groupsFor()` lists individual hide variants with complete immutable genotype records and base-coat colors. Legacy hides without genotype are ineligible rather than given a randomly invented coat.
- Crafting chooses one exact `hide:...` variant, calls `AnimalHides.consume(...,'pack',variant)`, decrements the count inventory and saves the world member.
- Each crafted `fur_hood` article owns `furHood: {kind, sourceKind, sourceItemKey, genotype, appearance, baseColor, hideStars}`, distinct from regular `weaving`. Pack-to-Gear migration copies this object without dropping genome data, and individual articles stay distinct even without custom patterns.
- The hood **base** retains the selected hide's base coat hue. Its **trim** normally inherits the first expressed natural pattern color, or the preferred `trimGene` when that gene is expressed; without an expressed pattern, trim falls back to base coat. An authored `trimColor: "base"` instead keeps the trim base-colored (Drenkirra uses this). Neither natural channel can be recolored with player dye. Reweaving changes only optional standard patterns and Dye C. An Advanced Loom can author a second overpass pattern.

## Sprite source and layering

The verified uploaded art lives in `docs/assets/cosmetics/clothes/hood/`. The `fur_hood` cosmetic uses `furhood-base_tl_m.png`, `furhood-trim_tl_m.png`, `furhood-base_mashtz_m.png`, and `furhood-trim_mashtz_m.png`. The rear plane explicitly substitutes the newly added `furhood-behind_tl_m.png` or `furhood-behind_mashtz_m.png` for the base, while retaining trim. Both new sprites were imported from `main` without merging unrelated changes. These two head-shape variants cover playable genders/species through the existing head-cosmetic fallback chain.

`docs/config/patterns/fur-hoods.json` records optional per-animal, **per-wearer-variant** front/back art, e.g. `species["gar-wolf"].parts["tletingan_male"].front`. These are names of the *animal artworks*, not back-of-head placement instructions. `FurHoodLeatherworking.orderLayersForView` is shared across the runtime and previews.

- **Front plane, back-to-front:** `<animal>-back` → `furhood-base` → `<animal>-front` → `furhood-trim`. The animal back is behind the hood, but still in the front plane.
- **Backplane, back-to-front:** `furhood-trim` → `<animal>-front` → `furhood-behind` → `<animal>-back`. The animal back sits over the rear hood silhouette.

An absent species piece simply drops out without disturbing the remaining order. `furhood-behind` retains the base layer role, natural coat color, and motif inheritance.

The manifest currently references the uploaded Gar-wolf, Grehlr, Drenkirra, Nelk, Puktuk and Voorg-ass parts that actually exist, with missing front/back sides omitted rather than guessed.

## Authoring natural gene markings

In **Tool Hub → Pattern Editor → Animal fur-hood markings**, select the animal species, wearer head fit, and **exact genotype pattern id**. Edit the ordinary motif in the Pattern Editor, assign it to the animal gene, and export **both** its PNG (to `docs/assets/patterns/fur-hoods/`) and `fur-hoods.json` (to `docs/config/patterns/`). Paths for special front/back sprites can also be edited there independently for the two wearer fits. These exports need committing to the repository before they become playable defaults.

Natural coat gene colors do not require any motif PNG. The `furhood-trim` sprite automatically adopts the selected expressed pattern pigment. Each species can choose `partColors.front` and `partColors.back` as `base` or `pattern` (the latter falls back to base when unpatterned), configurable in **Animal fur-hood markings → Animal front/back pigment → Save sprites and pigment routing**. Both wearer fits share the species routing. The optional `partGenes.front/back` may select a particular pattern gene rather than the default inherited color. An authored motif remains a separate optional drawing applied to `furhood-base`, `<animal>-front`, and `<animal>-back`; ordinary custom player weaving still layers above it. The runtime portrait resolver registers these sprite URLs even when there are zero motif PNGs, so equip, icons and previews use the same natural tint.

**Drenkirra:** Its hood base and trim take the genotype base-coat color (`trimColor: "base"`), while the animal-front sprite takes the inherited pattern color (`partColors.front: "pattern"`), falling back to base when unpatterned. **Exact source RGB `#94858E` and `#567372` are excluded from all fur-hood recoloring**, including optional motif overlays; neighboring coat colors are unaffected.

**Grehlr:** The actual front and back PNGs have white/gray stripe paint; those source pixels remain untouched when `coloredstripe` is not expressed, and when present receive its genotype pattern hue/saturation while retaining each original pixel's HSV value. In the back PNG, the separate mint-colored highlight/shadow family (actual authored source colors including `#9BC09A` and `#6F896E`) always takes the genotype's *base* coat hue/saturation. This reuses `ColorFill.hsvValueFillPixels` with disjoint source-region predicates, preserving alpha and outlines. Whole-part front/back selectors are disabled for Grehlr because each sprite uses these multiple independently keyed regions.

The manifest's `patterns[geneId] = {motifPng,settings}` is **optional** dev-authored geometry/placement only; it is not needed for genotype color routing. At render time `FurHoodLeatherworking.markingsFor` checks whether the saved hide expresses each gene, reads the color from `genotype[geneId].color`, and produces independent motif/color passes on the base layer before optional player `weaving` motifs. Animal motifs do **not** occupy either normal player weaving slot and are not saved in a garment's `weaving` field.

### Paint directly on the hood (developer tool)

In **Tool Hub → Pattern Editor → Animal fur-hood markings**, select the hide species, a genotype pattern from the dropdown (populated from `CreatureGenetics.PATTERN_DEFS`, with already-authored legacy keys retained), head-fit variant, and Front/Behind. Press **Paint directly on hood…** for the popup, or **Paint hood in right viewport** to temporarily replace the Pattern Editor’s main right-hand preview with the *same interactive painter* (not merely a picture). Save or close to return to the ordinary preview. Paint and erase on the real hood sprite, with touch-friendly zoom/pan, undo/redo, and individual pixel brushes. Both authoring surfaces automatically zoom to the paintable fur mask, ignoring transparent/black source-sprite padding while preserving original pixel coordinates for exact inverse projection. Only the fur-eligible substrate (hood base and species-specific front/back pieces) is writable; the decorative trim is excluded. The editor shows a separate **Actual in-game result** preview produced by the production clothing/genotype compositor, including the normal colored motif and black outline.

The author can control the ordinary weaving mesh **scale, rotation, X/Y offsets, X/Y stretch, and flips**. A shared inverse canvas transform converts the garment-space strokes into a **regular non-tiling motif PNG**. The runtime still consumes the standard `{ motifPng, settings }` record; no painted garment mask or new weaving slot is required for game logic. A narrowly scoped `garmentFixed: true` setting keeps the ordinary non-tiling pattern's source-frame center independent of ink bounds and disables the unrelated per-cell weave staggering. Because the same code supplies the inverse transformation and runtime mask projection, editing the pattern does not silently recenter it. The generated motif canvas expands to retain brush strokes even with rotation, offsets, or reduced scale; extreme projections are rejected with a visible error rather than cropped.

Press **Save motif** inside the paint overlay, then export **New animal motif PNGs** and **fur-hoods.json** from the existing authoring panel. Editor-only `authoring: { mode: 'hood-paint', width, height, view, operations, maskRle }` is saved under each species/gene manifest entry so the drawing can be reopened exactly, even after a clear or erase; it is ignored by the game. Switching to a different view can reproject the existing exported motif onto that hood, so you do not need to redraw it from scratch. This is still **one motif per animal gene** applied to all eligible fur pieces and wearer fits, not a separate pattern per view/head fit.

Transient brush previews use the ordinary compositor without inserting each temporary motif PNG into persistent sprite caches. For verification, run the dedicated regression test as well as the original fur-hood test:

```sh
node scripts/test-fur-hood-direct-paint.js
node scripts/test-fur-hood-leatherworking.js
```

**No motif artwork is required for basic inherited fur coloration.** The shipped manifest's `patterns` entries may remain empty for every animal; the base, inherited-color trim, configurable animal pieces, and Grehlr's source-keyed stripe/mint regions all colorize from the saved genotype. Export motif PNGs only when a drawn surface pattern is wanted.

## Quick verification

```sh
node scripts/test-fur-hood-leatherworking.js
```

The test checks the exact authored art filenames, manifest paths, genetic hue and allele persistence, nearest head-variant fallback, and the separation of natural/personal weaving data. The game also exposes `window.FurHoodLeatherworking.debugSnapshot()` and the normal ClothingWeavingSystem debug snapshot for mobile troubleshooting.

## Pending Nelk artwork

The existing Mashtzarr Nelk sprite was renamed from `furhood_nelk-behind_mashtz_m.png` to `furhood_nelk-back_mashtz_m.png` and its manifest path was corrected. The Tletingan `-front` sprite already exists. The manifest now references `assets/cosmetics/clothes/hood/furhood_nelk-back_tl_m.png`, with that exact path in `pendingAssets` because its image **will be uploaded by the artist after the PR is merged**. No temporary or fabricated PNG is included; load errors for this single missing asset are expected until upload. The regression test permits only this explicitly deferred file to be missing.

## Exact sprite-color exclusion eyedropper

Use **Animal fur-hood markings → Eyedrop raw sprite colors…** to choose a raw hood base, trim, animal-front or animal-back PNG from the selected species, wearer fit and view. Tap any *opaque* source pixel: its exact RGB hexadecimal value is added to either the global exclusions or that species' chosen sprite role. The inspector draws the original PNG and the before/after pigment fills together, with optional magenta highlighting to distinguish protected pixels. Removing a HEX chip updates both previews and the main full-hood preview immediately; it does not bake new sprites. The original `#94858E` and `#567372` defaults remain in the global list, now declared in `fur-hoods.json`.

**Export HEX list** produces a text file of effective exclusions; **Export exclusion lists (.json)** produces a portable global and per-species/role record. **Export fur-hoods.json** remains the canonical way to publish the editable lists for the game runtime. The runtime preserves original RGB/alpha on matching source pixels after natural tinting, genetic motifs and player weaving, with per-role cache keys; authored color tints, genotype, and species sprites remain unchanged. The inspector reports an absent `pendingAssets` file accurately and automatically opens it once uploaded.

Until the pending Tletingan Nelk PNG is uploaded, the clothing-layer preview gracefully skips **only** manifest-declared `pendingAssets` on image-load failure. Other missing sprite URLs continue to report errors. As soon as the future PNG is available at the declared path, the same code draws it automatically. The runtime portrait's existing failed-image handling likewise leaves the remaining hood artwork intact.

## Imported exact HEX exclusion exports (November 3, 2026)

The artist-exported `furhood-gar-wolf-exclusions.json`, `furhood-nelk-exclusions.json`, and `furhood-puktuk-exclusions.json` have been applied to `docs/config/patterns/fur-hoods.json`. Gar-wolf contains 36 authored animal-front HEX entries; Nelk contains 23; Puktuk contains 112. Global exclusions stay `#94858e` and `#567372`. These additions affect only `animalFront`; each exported `animalBack`, `base`, and `trim` list is empty. Nelk's exported `role` field indicates the inspector was displaying `animalBack`, but its actual `byRole.animalFront` array contains the 23 authored colors, so the imported runtime configuration follows `byRole` rather than relocating colors based on the inspector's selected role. Reimport is unnecessary unless more source colors are sampled.
