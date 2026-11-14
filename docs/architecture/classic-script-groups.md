# Parser-ordered classic script groups

The static game page needs classic, synchronous scripts in strict order. To reduce
unrelated PRs editing `docs/index.html`, compatible *late* scripts can move to
separate manifests in `docs/js/bootstrap/classic-groups/`.

Currently migrated:
- `qol.js`: toast, arrival, hotkeys, inventory search.
- `guild.js`: guild progression, magic checkpoint, vault signal.
- `render.js`: actor/mesh/grass culling and depth snapshot.

The stable index entry is:
```html
<script src="js/bootstrap/classic-script-group-loader.js?v=20261114classicGroups1" data-classic-group="qol"></script>
```

The loader runs while the HTML parser is active, writes a uniquely queried
manifest script, and that manifest writes its versioned child scripts in order.
`document.write` is intentional here: *async* dynamic insertion changes the
initialization semantics of the existing classic-script runtime. **Never invoke
this loader on DOMContentLoaded, asynchronously, or after parsing**.

To add or update a script in an existing group:
1. Edit only that group's ordered `scriptUrls` array, including the new
   `?v=<new token>` for changed modules. Do not edit `index.html`.
2. Keep evaluation-time dependencies ahead of consumers; keep `game.js`
   outside these groups.
3. Run `node scripts/test-classic-script-groups.js` and the normal regression
   suite. Update the test's known members if deliberately adding to a group.

The manifests are fetched with `?load=<Date.now()>` per navigation so manifest
edits do not require touching a common index cache token. Child modules retain
their usual versioned cache URLs; this costs one tiny extra manifest request per
group. The loader itself remains cache-versioned in `index.html` and should
rarely need changes.

Tests that need the **effective** shipped script list can import
`expandClassicScriptGroups` from `scripts/classic-script-group-index.js`.
This replaces each group loader tag at its parser position in the HTML string.
Do not silently assume a moved script is missing because it no longer appears
literally in `index.html`.

This first migration intentionally leaves early startup scripts and inline
boot handoff scripts in place. They have stronger parser/side-effect coupling.
