# Modular weapon recipe provenance and conservative cleanup

Audit completed 7 November 2026 for PR #1481. This note distinguishes **attachment mounts / fitted head primitives** from **saved recipe-box placements**. It does not claim to prove the user's private intentions.

## Evidence and chronology

1. **26 October — authored calibrations:** commit [e0a3c918c1e4](https://github.com/Oolnokk/HobunjiHollowUnity/commit/e0a3c918c1e4) imports a modular-weapon editor export with independently repositioned and rotated Kylie eye/tang lines, explicit layer ordering, and pair-specific corrections. No Kylie bridge or recipe operations existed at that point. Earlier commits [ed8070091051](https://github.com/Oolnokk/HobunjiHollowUnity/commit/ed8070091051) and [54f9c4e67c02](https://github.com/Oolnokk/HobunjiHollowUnity/commit/54f9c4e67c02) established individually adjustable companion tangs and multi-mount authoring.
2. **29 October — bulk recipe import:** commit [f6b3583913a7](https://github.com/Oolnokk/HobunjiHollowUnity/commit/f6b3583913a7) imports an authored config containing five saved recipes and dozens of pair operations. Six single-ended hafts each acquire **the same two recipes, same bounding boxes, across nine blade-head pairs**. There is no independently positioned box per head on these six hafts.
3. **31 October — intentional duplicate shaft:** [0ba3d07cbcef](https://github.com/Oolnokk/HobunjiHollowUnity/commit/0ba3d07cbcef) introduces the Hachutu Torch-Staff by copying B'Shuakauitl's mount and fitting rules, while retaining its own sprite and VFX. This is a separate, explicit whole-shaft duplication feature.

## Classification

| Haft | Evidence | Decision |
| --- | --- | --- |
| Kylie | 26 October hand-adjusted eye/tang lines and pair decisions; 29 October identical boxes on all nine blade heads | **Keep authored mounts/overrides; remove 18 copied recipe placements** |
| Hatchet, Hoe, Fishing Mace, Warhammer, B'gungku | One eye + one tang; identical two recipe placements on each of nine heads; no pair-specific variation in their placed-box geometry | **Remove 18 copied placements per haft (90 total)** |
| B'Shuakauitl | Two separated tang/eye fitting regions; independently sized boxes and many distinct manual strokes and junctions | **Keep** |
| Pick-Shovel | Two separated tang locations and an eye mount; boxes fit within the reference sprite frame; some homogeneous placement evidence is ambiguous | **Keep pending manual visual review** |
| Hachutu Torch-Staff | Explicit copy of B'Shuakauitl with separate fire and whole-shaft identity | **Keep** |
| Dagger-Sword and War-Cleaver hafts | Distinct non-recipe bridge/paint/cleanup operation histories | **Keep** |

The two recipes removed from single-ended hafts are `recipe-1` and `tanged-head---sleeved-shaft`. Both remain available as shared templates; their *placements*, not their definitions, were deleted.

A particularly strong anomaly is that the second box extends beyond the original **450 × 1204** weapon frame on all six single-ended hafts. For Kylie it extends to approximately x=547 and y=1850; for Hoe, to y=1975. This is plausible as an automatic mount-box remapping artifact, not evidence of custom cleanup around each selected head.

**Totals:** 108 placements removed from 54 single-ended head/haft pairs; 36 multi-ended recipe placements retained (11 on B'Shuakauitl, 14 on Pick-Shovel, and 11 on Torch-Staff). All existing non-recipe operations, source sprites, mount geometry, pair layer order, craft restrictions, fire settings, and five recipe definitions are retained.

## Why only high-confidence copies were removed

The Git history shows where the configuration changed but cannot establish which individual action a human approved. A user could intentionally have chosen bulk placement. Therefore this audit does **not** delete unique edits or inferred manual changes. It specifically removes the repeated *unchanged* signature across single-ended hafts, on the basis of the later report that duplication appeared unexpectedly on Kylie.

## Browser-draft safety

The modular weapon editor deliberately shares local draft data with gameplay on the same browser origin. An old `hobunji.modularWeapons.v5` localStorage draft can therefore reintroduce previously saved placements even after the shipped config is cleaned. The editor loads `recipe-provenance.js`, counts the 29 October fingerprints, and offers **Remove recognized accidental bulk placements from my draft**. The action requires confirmation and is undoable as one editor history step. It preserves any box with edited coordinates, mirroring or proportion-locking, and any placement whose shared recipe template has been edited (detected by a deterministic canonical-content fingerprint). It does not automatically erase local authoring data.

The **Bulk place** button is now restricted to multi-ended hafts with at least two physically distinct tang mounting positions plus an eye mount, shows affected hafts and pair count, and requires confirmation. Single-ended hafts like Kylie are not selected by this bulk action.

## Regression protection

`scripts/test-modular-editor-behavior.js` verifies the real committed config has no matching single-ended recipe placements; the Torch-Staff, B'Shuakauitl and Pick-Shovel remain eligible; confirmed/cancelled bulk authoring has the expected scope; Kylie retains its original mounts; a synthetic old draft matches 18 Kylie placements; a manually edited box survives the exact cleanup; and individual editor cleanup still preserves neighboring operations. Full CI runs in PR #1481. A separate Playwright mobile-viewport smoke now opens the actual editor with an older Kylie draft, checks touch-accessible controls, edits and clears recipe boxes, and verifies Undo/Redo and bulk-confirmation behavior. The review also fixed a mobile sticky-preview overlay that had intercepted taps, and rejected prototype-property names as duplicate-haft donors without crashing import.
