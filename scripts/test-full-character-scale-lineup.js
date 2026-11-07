'use strict';
const assert = require('node:assert/strict'); // Checks representative identity and database isolation.
const fs = require('node:fs'); // Loads the shipping comparison code and authored NPC database.
const vm = require('node:vm'); // Executes the private representative selector without WebGL.
const source = fs.readFileSync('docs/js/character-scale-comparison.js', 'utf8'); // Shipping implementation under test.
const db = JSON.parse(fs.readFileSync('docs/config/npcs/hobunji-starter-npc-database.json', 'utf8')); // Real authored NPCs, including both Mashtzarr genders and Tletingan donors.
const original = JSON.stringify(db); // Detects accidental mutation of world NPCs.
const window = { HOBUNJI_ATTACHMENT_RIG_PROFILES: { characters: {} } }; // Supplies independently registered species/gender profiles as the runtime does.
for (const species of ['tletingan', 'nuhongan', 'longoran', 'mashtzarr']) {
  for (const gender of ['male', 'female']) {
    window.HOBUNJI_ATTACHMENT_RIG_PROFILES.characters[`${species}::${gender}`] = { species, gender };
  }
}
const context = vm.createContext({ // Minimal browser globals; test-only injection exposes the private selection path.
  window, URL, console,
  location: { pathname: '/tools/animation-author/index.html', href: 'https://example.test/tools/animation-author/index.html' },
  document: { getElementById() { return null; } },
  setInterval() { return 1; },
  fetch: async () => ({ ok: true, json: async () => db }),
});
vm.runInContext(source.replace('  install();\n})();', '  window.testLineup = { representatives, portraitExportFor };\n})();'), context);
(async () => {
  const lineup = await window.testLineup.representatives(); // Exercises the same selector used by buildLineup.
  for (const species of ['nuhongan', 'longoran', 'mashtzarr']) {
    for (const gender of ['male', 'female']) {
      const entry = lineup.find(item => item.key === `${species}::${gender}`); // Checks all four requested independent entries.
      assert(entry?.npc, `${species} ${gender} must have a renderable representative`);
      assert.equal(window.testLineup.portraitExportFor(entry.npc).appearance.speciesId, species);
      assert.equal(window.testLineup.portraitExportFor(entry.npc).appearance.gender, gender);
      if (species === 'nuhongan' || species === 'longoran') assert.equal(entry.npc.id, `full_scale_${species}_${gender}_preview`);
      else assert(db.npcs.includes(entry.npc), 'Mashtzarr should retain authored representatives');
    }
  }
  assert.equal(JSON.stringify(db), original, 'preview clones must not modify shipping NPC records');
  const authored = JSON.parse(JSON.stringify(lineup.find(item => item.key === 'nuhongan::male').npc)); // Simulates a future authored Nuhongan NPC superseding the fallback.
  authored.id = 'authored_nuhongan';
  db.npcs.push(authored);
  assert.equal((await window.testLineup.representatives()).find(item => item.key === 'nuhongan::male').npc.id, authored.id);
  const originalNpcs = db.npcs; // Remove adult female Tletingan fixtures to verify the alternate-gender donor fallback.
  db.npcs = originalNpcs.filter(npc => {
    const ap = window.testLineup.portraitExportFor(npc).appearance;
    return ap.speciesId !== 'tletingan' || ap.gender !== 'female';
  });
  const noFemaleDonor = await window.testLineup.representatives();
  for (const species of ['nuhongan', 'longoran']) {
    const entry = noFemaleDonor.find(item => item.key === `${species}::female`);
    assert(entry?.npc, `${species} female still needs a representative without a female Tletingan NPC`);
    const ap = window.testLineup.portraitExportFor(entry.npc).appearance;
    assert.equal(ap.gender, 'female', 'female preview must not render as the donor male');
    assert.equal(ap.speciesId, species);
  }
  db.npcs = originalNpcs;
  assert.match(source, /id="maaLongoranTuning"/, 'Full Character Scale must expose Longoran editing');
  for (const axis of ['Hunch','Kyphosis','Lurch','Cadence','Stance','DragLift']) {
    assert(source.includes(`tuningRow('${axis}'`), `missing Longoran authoring control ${axis}`);
  }
  assert.match(source, /function refreshLongoranPresentation\(/, 'Editor must rebind spine and procedural feet on tuning changes');
  assert.match(source, /function tick\(dt\)/, 'Walking preview must follow the Animation Author frame clock');
  const author = fs.readFileSync('docs/tools/animation-author/index.html', 'utf8');
  assert(author.includes('HobunjiFullCharacterScaleComparison?.tick?.(dt, now)'), 'Animation Author must invoke the comparison preview tick');
  console.log('Full Character Scale Longoran/Nuhongan/Mashtzarr lineup and Longoran authoring checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
