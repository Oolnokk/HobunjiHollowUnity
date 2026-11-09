# Imperial Witchcraft Checkpoint and Garanki Custody

## Canon

The Delver's Stone proves Delver's Guild membership and unlocks sealed Harlyao ruins. **It does not signal contraband by glowing, beeping or reporting the player's movements.** The Harlyao Key Talisman is a separate quest-specific locator and retains its pulsing light and sound near the vault.

Senior Imperial law-enforcement officers may be commissioned with a magical-imprint detector. Spearhead received one on becoming guard captain. His amulet senses *unregistered* witchcraft and raises an alert when the player returns to Hobunji Hollow with an unregistered bound or cursed object. Oddclaw accompanies him on the initial confrontation.

## Encounter

Source: \`docs/js/town-magic-checkpoint.js\`. Entry: \`enterTown\` in \`docs/game.js\`.

- Only real **exterior-to-town** crossings with unregistered bound/cursed possessions trigger the checkpoint. Leaving a shop, the temple, the inn or another town interior never summons the guards. With no contraband there is **no checkpoint cutscene**.
- First contraband entry: both guards are staged **two walkable tiles inside the approached perimeter gate**, facing the player. The cinematic uses the actual entrance orientation for all four sides of town and moves the real player to its safe final tile. Spearhead recognizes the player after initially expecting a fight, explains his Imperial amulet, and asks about enchanted possessions. Nonmembers can say **Yes** or **I don't know**; the latter paths him behind the player, turns him to inspect the bag, and rejoins the common confession. A Guild member can only answer **I have a license**, which still requires registration.
- Repeat nonmember encounter: **You know the drill**, with the same Yes/Don't know choice and a brief confiscation explanation.
- First licensed encounter: one license response. After that, later licensed encounters are **automatic short speeches** with no repeated question.
- A cutscene interruption or failed custody-state write never removes items. The final line must be continued to trigger confiscation.

The authoritative item predicate includes encoded Harlyao bound relics; inventory definitions tagged \`Bound\` / \`Cursed\` or explicitly marked as magical; and individual cursed/bound \`packClothing\` records. The licensed Delver's Stone itself is not contraband.

## Custody storage and registration

Garanki's existing **Artifacts, Custody & Enchanting** panel displays **Confiscated belongings** at the top, before the artifact collection and enchanting services. This is a separate custody inventory, not a copy of the player's pack.

The ledger is stored in the portable \`openingStory.delversGuild.townMagicCheckpoint.members[characterId]\` record. Each item is stored with its exact serialized identity:

- Stack inventory entries preserve their canonical item key and count. A bound Harlyao weapon's key preserves its shape, unique ID, enchantments, and VFX colors.
- Cursed clothing entries preserve the full garment object, including UID, dyes, patterns, and curse payload.
- Separate \`registered\` identities record **uniquely identifiable** weapons and clothing returned to this owner. Because generic inventory stacks have no individual IDs, \`registeredCounts\` tracks how many units of the same key may lawfully be carried; quantities exceeding that allowance are confiscated, without removing the lawful portion. This quantity-based distinction remains a limitation until those items support individual IDs.
- The Guild license permits **Register & reclaim** on individually safe entries. Soul-bound masks are held as dangerous; they are not silently released or converted to ordinary garments. A priest-specific cure is a separate future workflow.
- People who have not joined the Guild can inspect the list through a **Review confiscated belongings** choice in Garanki's normal or story dialogue, but cannot register/reclaim its contents. Vault handoff/report and private trust dialogue also retain access to custody. After a confiscation, Garanki offers Guild enrollment without requiring the unrelated Jubmir invitation. This alternate introduction does not refer to the Great Fey unless Jubmir has actually discussed them.

Confiscation writes the world-owned custody record **before** removing the character's inventory and saving that inventory; a load-time reconciliation removes duplicated distinct bound items/garments if the second write was interrupted. Generic stacks use a one-shot \`pendingRemoval\` marker recording the exact excess and expected lawful balance. Registration first records a pending release, then saves the returned item, then removes its custody entry; an interrupted transfer is reversed on load rather than duplicating belongings. The canonical member save now reports success or failure so an escrow marker cannot be finalized after a rejected member-inventory write. Ownership is per-character, preventing another farmhand from opening and claiming the owner's held belongings.

## Maintenance and diagnostics

- Test: \`node scripts/test-town-magic-checkpoint.js\`. Exercises first/repeat/licensed scenes, all four authored gate orientations, real inventory transfer, colors/patterns, registered quantities, dangerous masks, aborted cutscenes, stale timer cancellation, save failures, interrupted transfer/release recovery and referral-based Guild enrollment.
- Existing regression: \`node scripts/test-delvers-guild-story.js\`.
- On mobile: open Garanki's Artifacts, Custody & Enchanting panel, then **Custody diagnostics** for a readable state snapshot. Dev Companion state provider: \`townMagicCheckpoint\`.
- Reusable integrations: \`TownMagicCheckpoint.pending()\`, \`hasCustody()\`, \`onTownEntered(...)\`, \`registerAndReturn(id)\`; catalog predicates can recognize additional bound/cursed item types without a second law-enforcement system.
