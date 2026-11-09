# Animal companion combat responsiveness

## Ownership
`docs/js/companion-combat-response.js` owns the lightweight target selection and response decisions. `docs/game.js` retains movement, collision, resource transactions and attack animation scheduling. `docs/js/combat/combat-animal-attacks.js` owns named attacks and Furious interrupt lifecycle. This deliberately avoids a second update loop.

## Priority and commitment
- Each active fighting companion considers living, visible hostile entities in the current area, weighted toward protecting the master and toward targets already close to the pet.
- An enemy attacking the owner takes priority over an otherwise comparable idle opponent. A pet targeted directly by an enemy within half the owner's alert radius also defends itself, even just beyond the master's normal alert circle.
- Keep the current enemy until a challenger is at least 24% more urgent; owner/pet attackers can interrupt sooner. This avoids flip-flopping across Set iteration order.
- Retargeting during an old two-second backup beat clears that backup, but **not** the attack cooldown. If the enemy escapes normal reach during backup, pursue immediately. A direct threat to the master also interrupts backup.
- Explicit Sicced and PlayerDowned target orders still override normal target selection. Ignore dead/downed focus targets.
- A committed named attack can finish against its original living enemy even when the enemy briefly crosses the master's alert boundary.

## Interruptions and affordability
- Prone/knockback/ledge-fall cancel staged named animal attacks and ordinary telegraphs; named cancel() restores an interrupted Furious cooldown.
- Don't overwrite an already active named attack with a second start request or start one on a defeated actor.
- Taxed Stamina affects normal attack readiness; unaffordable named top-ups decline and use the existing bite fallback rather than exhausting the pet.
- Unmigrated companions without explicit `master` still qualify for their owner's Furious attack; another owner's pets do not.

## Swarm rescue coordination
`Combat.attach` owns temporary rescue movement and impact. Companions with an active `_honeyfuzzleRescueTarget` do **not** run follow/chase movement over it. The temporary target is dropped when the swarm detaches. Friendly fire is restricted to this explicit rescue path; the companion's ordinary targeting still excludes the player.

## Diagnostics
`window.CompanionCombatResponse.debugSnapshot(companion)` returns current target, priority score, active rescue target, backup state and cooldown for mobile diagnostics. Target acquisition/change also emits `__farmLog` entries in the `combat` category.

## Regression coverage
- `scripts/test-companion-combat-response.js`: target priorities, area/health/hidden filtering, hysteresis, defense of owner/pet, backup interruption, and live integration.
- `scripts/test-companion-combat-lunge.js`: existing lunge commitment/collision plus duplicate-start prevention and insufficient extra-cost fallback.
- `scripts/test-furious-companion-quick-sfx.js`: Furious cooldown restore, legacy master fallback, and interruption.
- `scripts/test-companion-tactics.js`: real weighted tactical action and payment integration.
