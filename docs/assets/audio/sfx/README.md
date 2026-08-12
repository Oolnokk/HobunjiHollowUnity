# Sound effects — what's real, what's a placeholder

This folder mixes finished sound effects (used directly) with a handful of
**placeholder** sounds that stand in for real recordings that haven't been
sourced yet. This file is about the second kind.

## How the fallback works

Every "object/machine/UI" sound cue in the game (see `audio.objectSfx` in
`docs/config/scratchbones-config.js` and `playObjectSfx` in `docs/game.js`)
names **two** things:

- `url` — the real recording, in `sfx/ui/`, `sfx/processing/`, or
  `sfx/farming/`. **These files do not exist yet.** You need to add them.
- A placeholder — either `placeholderUrl` (one generated `.wav` in
  `sfx/placeholders/`, already committed) or `placeholderUrls` (a list —
  the cue reuses the real footstep recordings in `sfx/footsteps/`, already
  committed, at a different volume/pitch instead of a synthesized sound).

At runtime, the game always tries the real file (`url`) first. If it's
missing (404) or fails to decode, it automatically falls back to the
placeholder — no code changes needed. **As soon as you drop a correctly
named file at the `url` path below, the game starts using it instead of the
placeholder, immediately, with nothing else to wire up.**

A plain `<audio>.volume` can't go above 1.0 (its natural recorded
loudness) — a `"volume": 0.95` cue is already about as loud as the element
can play it. Cues that need to read as louder than that anyway (the direct
physical-action ones — digging, climbing, harvesting, fishing) set
`"gainBoost": 3` instead, which routes playback through a Web Audio
`GainNode` whose gain can genuinely exceed 1.0 and amplify the source. If a
real recording you add for one of those still sounds too quiet once it's
in, that's what to raise (or lower) — don't fight it by re-recording
louder, the `gainBoost` number does that job.

## What's deliberately NOT wired up to a sound

Only two kinds of "you did a thing" feedback exist on purpose:

1. **Menu clicks** — buttons inside the tabbed main menu (`#menuPanel`:
   Inventory/Calendar/Map/Farm/Stable/Loadout/Settings/etc.) play `uiClick`.
2. **"That didn't work"** — any blocked/failed action (`showToast(msg,
   false)`) plays `error`, everywhere, menu or gameplay alike.

Nothing else gets a generic acknowledgement sound — not the in-game action
bar, not world-object interactions, not a successful action. Those already
communicate through their own visual feedback (the toast text, the world
actually changing) or, for the specific actions listed in the table below,
a distinctive contextual sound. A ding on every successful dig/till/plant
across the whole game was tried and turned out to be pure noise; don't
re-add a general `confirm`-style cue without a specific reason.

Weapon swings (basic taps, combo hits, quick attacks, Charged Breaker) are
silent here for the same reason plus one more: they already have their own
dedicated `weaponSlash`/`creatureClawHit` sfx (see `audio.combatSfx`). If
you're adding a new attack type, call `showToast(msg, ok, true)` (the 3rd
`silent` argument) for its per-swing result, same as the existing ones.
A successful fishing spear catch reuses this same `weaponSlash` cue
(`playWeaponSlashSfx()`) rather than a new `objectSfx` entry — a landed
spear is a landed hit, same sound as landing any other weapon strike.

## What to get, and where it goes

All real files should be short one-shots, mono or stereo, `.mp3` (any
sample rate the browser can decode is fine — 44.1kHz is the safe default).
Keep them brief: under ~1 second for the UI/farming sounds, under ~2 seconds
for the processing sounds — they play on every interaction, so anything
longer starts to feel sluggish.

| Sound | Save as | What it should sound like | Placeholder today |
|---|---|---|---|
| Menu button press | `sfx/ui/sfx_ui_click.mp3` | A very short, quiet, unobtrusive UI tick. Only plays inside the tabbed main menu — never in gameplay. | generated tone |
| Action blocked/failed | `sfx/ui/sfx_ui_error.mp3` | A short, mild "that didn't work" blip — not harsh or alarming, this covers routine stuff like "no seeds left" as often as real mistakes. | generated tone |
| Digging | `sfx/farming/sfx_dig.mp3` | A shovel/pick biting into dirt — a heavier, louder impact than a footstep, not just a step sample played as-is. | real gravel-step recordings, louder + pitched down |
| Harvesting/picking a crop, wild plant, or berry | `sfx/farming/sfx_harvest.mp3` | A quick pluck/snap through leaves and stems — louder than an ordinary footstep. Shared by farm crops, wilderness reagent plants, and wild berry bushes — all three are the same gesture. | real grass-step recordings, louder |
| Cliff-climb stagger | `sfx/farming/sfx_climb_step.mp3` | A very low, heavy scuff on loose rock — one per scripted hop while scaling a cliff face, distinct from a normal footstep. | real gravel-step recordings, pitched way down |
| Casting the fishing line | `sfx/farming/sfx_fish_cast.mp3` | A loud splash/plop — bait hitting the water. | real water-step recordings, louder |
| Fish bites (bubbles rise) | `sfx/farming/sfx_fish_bite.mp3` | An even bigger splash than the cast — the moment a bite becomes reactable. | real water-step recordings, louder + lower |
| Fish gets away | `sfx/farming/sfx_fish_miss.mp3` | A low, disappointed splash — the spear missed or the fish escaped. Plays alongside the generic error blip. | real water-step recordings, low-pitched |
| Starting to process an aging batch | `sfx/processing/sfx_process_start.mp3` | A mechanical engage/click — the moment an Aging Barrel or Aging Vase is loaded and starts its multi-day timer. | generated tone |
| Pestle Station finishes | `sfx/processing/sfx_process_pestle.mp3` | Mashing/pounding — mortar-and-pestle thuds. | real gravel-step recordings, pitched down |
| Squeezing Vat finishes | `sfx/processing/sfx_process_squeezer.mp3` | A press/squeeze — juice being squeezed out. | real water-step recordings, pitched down |
| Hand Mill finishes | `sfx/processing/sfx_process_handmill.mp3` | Grinding — a hand-crank mill crunching grain. | real gravel-step recordings, pitched up |
| Drying Rack finishes | `sfx/processing/sfx_process_dryingrack.mp3` | Something soft and dry — a light rustle, not percussive. | generated noise swell |
| Smoking Hut finishes | `sfx/processing/sfx_process_smoker.mp3` | A soft hiss/waft — smoke, not fire. | generated noise hiss |
| Aging Barrel collected | `sfx/processing/sfx_process_agingbarrel.mp3` | A deep wooden knock/creak — a barrel being tapped or opened. | real gravel-step recordings, pitched way down |
| Aging Vase collected | `sfx/processing/sfx_process_agingvase.mp3` | Something ceramic/glassy — a light clink, opening a sealed vase. | generated tone |

Several of these reuse the real `sfx/footsteps/` recordings (louder, and
pitched up or down) as their placeholder instead of a synthesized sound —
a real recording standing in for something in the same ballpark (a mashing
thud, a grinding crunch, digging into dirt) reads better than a from-scratch
synth attempt at those. That's a stopgap, not a suggestion to skip
recording the real ones — footsteps and, say, a mortar-and-pestle should
still end up sounding distinct once you've sourced `sfx_process_pestle.mp3`.

## Regenerating the placeholders

The generated (non-footstep-derived) placeholders are procedurally
synthesized, not recorded — see `scripts/generate-placeholder-sfx.js` (pure
Node, no dependencies). If you add a new `objectSfx` cue that isn't a good
fit for reusing a footstep recording, add a matching synthesized sound to
that script and run:

```
node scripts/generate-placeholder-sfx.js
```

This regenerates every file in `sfx/placeholders/` deterministically (same
output every time unless you change the script), so it's safe to re-run
any time.

## Everything else in this folder

`bgs/` (weather/ambience loops), `footsteps/` (grass/gravel/water step
recordings), and the loose combat one-shots at the top level
(`sfx_slash-basic.wav`, `sfx_claw-basic.m4a`, creature barks/growls,
`sfx_thunder1.mp3`) are all real, finished assets already in use — nothing
in this README applies to those, except that a few placeholders above
borrow from `footsteps/` as described.
