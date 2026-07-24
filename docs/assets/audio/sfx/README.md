# Sound effects — what's real, what's a placeholder

This folder mixes finished sound effects (used directly) with a handful of
**placeholder** sounds that stand in for real recordings that haven't been
sourced yet. This file is about the second kind.

## How the fallback works

Every "object/machine/UI" sound cue in the game (see `audio.objectSfx` in
`docs/config/scratchbones-config.js` and `playObjectSfx` in `docs/game.js`)
names **two** files:

- `url` — the real recording, in `sfx/ui/` or `sfx/processing/`. **These
  files do not exist yet.** You need to add them.
- `placeholderUrl` — a generated placeholder in `sfx/placeholders/`. **These
  already exist** and are committed to the repo.

At runtime, the game always tries the real file (`url`) first. If it's
missing (404) or fails to decode, it automatically falls back to the
placeholder — no code changes needed. **As soon as you drop a correctly
named file at the `url` path below, the game starts using it instead of the
placeholder, immediately, with nothing else to wire up.**

## What to get, and where it goes

All real files should be short one-shots, mono or stereo, `.mp3` (any
sample rate the browser can decode is fine — 44.1kHz is the safe default).
Keep them brief: under ~1 second for the UI sounds, under ~2 seconds for
the processing sounds — they play on every interaction, so anything longer
starts to feel sluggish.

| Sound | Save as | What it should sound like |
|---|---|---|
| Button press | `sfx/ui/sfx_ui_click.mp3` | A very short, quiet, unobtrusive UI tick. Plays on *every* button press across the whole game, so keep it subtle. |
| Action succeeded | `sfx/ui/sfx_ui_confirm.mp3` | A short, pleasant confirmation chime. Plays on basically every successful action (farming, shipping, placing furniture, processing, buying) — the single most-heard sound in the game, so it should be satisfying but never annoying on repeat. |
| Action blocked/failed | `sfx/ui/sfx_ui_error.mp3` | A short, mild "that didn't work" blip — not harsh or alarming, this covers routine stuff like "no seeds left" as often as real mistakes. |
| Starting to process an aging batch | `sfx/processing/sfx_process_start.mp3` | A mechanical engage/click — the moment an Aging Barrel or Aging Vase is loaded and starts its multi-day timer. |
| Pestle Station finishes | `sfx/processing/sfx_process_pestle.mp3` | Mashing/pounding — mortar-and-pestle thuds. |
| Hand Squeezer finishes | `sfx/processing/sfx_process_squeezer.mp3` | A press/squeeze — juice being squeezed out. |
| Hand Mill finishes | `sfx/processing/sfx_process_handmill.mp3` | Grinding — a hand-crank mill crunching grain. |
| Drying Rack finishes | `sfx/processing/sfx_process_dryingrack.mp3` | Something soft and dry — a light rustle, not percussive. |
| Smoking Hut finishes | `sfx/processing/sfx_process_smoker.mp3` | A soft hiss/waft — smoke, not fire. |
| Aging Barrel collected | `sfx/processing/sfx_process_agingbarrel.mp3` | A deep wooden knock/creak — a barrel being tapped or opened. |
| Aging Vase collected | `sfx/processing/sfx_process_agingvase.mp3` | Something ceramic/glassy — a light clink, opening a sealed vase. |

## Regenerating the placeholders

The placeholders are procedurally generated, not recorded — see
`scripts/generate-placeholder-sfx.js` (pure Node, no dependencies). If you
add a new `objectSfx` cue in `scratchbones-config.js` before its real
recording exists, add a matching synthesized sound to that script and run:

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
in this README applies to those.
