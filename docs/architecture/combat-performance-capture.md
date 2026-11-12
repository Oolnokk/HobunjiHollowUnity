# Combat slow-frame capture (mobile)

This is an **instrumentation-only** workflow. It does not slow AI decisions, alter collisions, disable effects, or change combat behavior. The capture is disabled with the existing **Performance Profiler** toggle; ordinary gameplay does not allocate frame histories.

## Capture a comparable fight

1. Open **Settings → Performance & diagnostics** and enable **Performance Profiler**. Leave the experimental GPU-sync and hide-all-NPC toggles **off** during baseline tests.
2. Tap **Reset capture** before each scenario. This also clears old subsystem averages, so a past map or previous fight cannot dominate the readout.
3. Close Settings and reproduce one condition for several seconds: (a) enemies idle and visible; (b) chasing; (c) swinging but missing; (d) hits landing; (e) volleys; (f) several simultaneous deaths.
4. Reopen Settings and tap **Copy capture**. On Android, if clipboard access fails, the selectable report appears in the existing Performance report textbox.
5. Paste the JSON into the performance investigation discussion, labeling the scenario and camera angle. Alternatively, Pixel Probe includes the same slow-frame history under **Combat slow frames**.

Capture several runs at the same camera angle and actor count. The Performance Profiler itself has measurable overhead: keep it on for every comparison, or off for every comparison, rather than mixing conditions.

## How to read the numbers

- **cpuMs**: actual synchronous JavaScript time inside the current gameLoop bracket.
- **intervalMs**: time between game-loop starts. This interval includes waiting since the **previous** frame; it is not the GPU cost of the current frame. An interval-only spike is explicitly labeled as *preceding frame*.
- **renderPassCpuMs**: time spent issuing the current frame's world render passes. This is not a true GPU completion measurement.
- **top[].exclusiveMs**: each named bracket's own CPU cost with nested timed children subtracted. Never sum the old subsystem moving averages and treat them as a single-frame breakdown.
- **gameLoop uninstrumented**: time inside gameLoop not attributed to any named nested bracket (not evidence that the CPU is idle).
- **counts**: event counts during that same frame, such as ring rebuilds, afterimage snapshots, damage popups and lunge stamps.
- **gauges**: active hostiles, engaged hostiles, bandits and projectiles for that frame.

The recorder captures **cpuMs ≥33.3 ms** or **intervalMs ≥50 ms**. It keeps only the last **12** slow frames plus the worst CPU sample. It deliberately avoids sorting and serializing the detailed phase breakdown during ordinary frames. The CPU timer cannot see browser compositor work or asynchronous GPU execution. The separate **Force GPU sync** switch is expensive and should be tested only in a short, deliberately isolated comparison.

## Diagnostic mapping

| If the slow-frame breakdown shows… | Investigate first |
| --- | --- |
| `render: main scene`, `render: shell outline`, `held-overlay:*`, `render passes` | Multipass rendering, actors participating in replays, and full-screen fallbacks |
| `Combat: creature rig sync`, `Combat: bandit swing pose` | Portrait/hand/weapon synchronization and rig complexity |
| `Combat: bandit tactical AI` or a large residual `hostiles` bucket | Decisions, LOS, collision recovery, movement and wild-animal logic |
| `Combat: resource ring rebuild` plus `ringRebuilds` | Dynamic resource ring geometry churn after damage |
| `Combat: afterimage snapshot` plus `afterimageSnapshots` | Portrait texture copies and geometry baking during lunges/dodges |
| `Combat: lunge stamp creation` plus `lungeStamps` | Per-stamp RingGeometry/material creation |
| `Combat: projectile collision`, `Combat: projectile simulation`, `projectiles` | Ranged cover, actor hitboxes, projectile trails and embeds |
| `Combat: damage popup creation` plus `damagePopups` | Canvas-to-texture creation on simultaneous hits |
| Interval-only spikes with ordinary loop CPU | GPU backpressure, browser rendering, another task or an unmeasured wait; do not assume cause from the *current* CPU breakdown |

For a profiler regression check, run:

```bash
node scripts/test-combat-frame-spikes.js
```

See also [Performance investigation log](performance-investigation-log.md) for historical measurements and implementation notes.
