# Shared gameplay input router

The canonical device-neutral owner is `window.GameplayInputRouter`, implemented in
`docs/js/world-action-input-claims.js`. The exported
`window.WorldActionInputClaims` object is **the same object**, not another
input registry. The old name is preserved for established world-action providers.
This does not replace `InputBindings` (which converts physical keys/gamepad
buttons into semantic action IDs) or each gameplay system's action executor.

## One press, one owner

1. `InputBindings` maps keyboard, mouse, touch arch and controller events to
   semantic action IDs (`action1`, `action2`, `action3`, `interact`, etc.).
2. Interaction providers declare actions via `setClaims(ownerId, claims)`.
   The highest-priority advertised claim owns that semantic input; the first
   declared claim wins ties. `route(actionId, phase, detail, fallback)` offers
   the event to the current owner, and calls the optional fallback only when
   no active claim consumes the event.
3. A claimed **press stays owned through release** even after its provider
   clears the claim or the reticle leaves the object. Key repeats never fire
   `onPress` a second time. `cancel` releases the owner with
   `{ canceled: true }`.
4. The *currently rendered* action arch remains authoritative for contextual
   replacements. `configure({ isContextOverride })` asks game.js whether
   semantic Action 1/2 would perform something other than its normal combat
   action. Gameplay executors remain in their existing modules.
5. `isAttackBlocked()` becomes true if Action 1 **or** Action 2 has an
   advertised claim, an active claimed press, or a visible contextual
   replacement. It does not check Action 3 or other actions. All melee
   tap/hold/queued callbacks, ranged firing and thrown windup/release use the
   same guard. An attack interrupted midway must not turn into a tap after
   the contextual target disappears.
6. `canContinueHold(kind, held)` is used for non-combat world holds (nests,
   tents, skeletons/corpses, hives and companion revival). If combat starts
   during a hold, it latches a rejection until that input is released. This
   deliberately does **not** forbid combat abilities or potion selectors
   merely because those inputs can also be held.

## Provider example

```js
window.GameplayInputRouter.setClaims('my-world-object', [{
  actionId: 'action1',
  label: 'Inspect glyph',
  priority: 100,
  onPress: () => inspectGlyph(),
  onRelease: ({ canceled } = {}) => { if (canceled) cancelGlyphInspection(); },
}]);
// When interaction is no longer available:
window.GameplayInputRouter.clearClaims('my-world-object');
```

Call `route` for physical press/release/cancel pairs; do not synthesize a
second weapon press after the action was claimed. For ordinary touch-arch
contextual actions, retain the **press-time meaning** through pointer release.
The module's `snapshot()` reports owner claims, active press ownership,
interrupted world holds, latest route and current attack suppression. Mobile
Pixel Probe includes the same summary.

## Checks

`node scripts/run-tests.js gameplay-input-router` covers claimed presses,
repeat/release, priority, contextual Action 1/2 versus Action 3, combat hold
latching and the actual combat tap/hold input machine.
