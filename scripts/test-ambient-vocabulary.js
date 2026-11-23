#!/usr/bin/env node
// Regression coverage for word generation, one-shot floating speech and editor integration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..'); // Repo root used for fixtures and production script evaluation.
const file = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value)); // Compare cross-VM arrays/objects as authored JSON, without false prototype failures.
const config = JSON.parse(file('docs/config/dialogue/ambient-vocabulary.json'));
const profiles = JSON.parse(file('docs/config/dialogue/npc-reaction-profiles.json'));
const window = {};
const context = vm.createContext({
  window,
  fetch: async url => ({ ok: true, status: 200, json: async () => String(url).includes('ambient-vocabulary.json') ? config : profiles }),
}); // Evaluates actual browser modules with their configuration fetches, not a test-only clone.

async function testStandaloneEditorInteraction(rules) {
  const elements = new Map(); // Simulates the editor's minimal DOM event and content surfaces without requiring a browser binary.
  function element(id, dataset = {}) {
    let html = ''; // Kept per node so querying the same HTML returns the event-enabled nodes already bound by the editor.
    const lookup = new Map();
    return {
      id, dataset, value: '', textContent: '', checked: false,
      get innerHTML() { return html; },
      set innerHTML(value) { html = String(value); lookup.clear(); },
      querySelector(selector) {
        const match = /^\[data-([a-z-]+)="([^"]+)"\]$/.exec(selector);
        if (match) {
          const key = match[1].replace(/-([a-z])/g, (_, char) => char.toUpperCase());
          return this.querySelectorAll('[data-' + match[1] + ']').find(node => node.dataset[key] === match[2]) || null;
        }
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        if (lookup.has(selector)) return lookup.get(selector);
        const attribute = /^\[data-([a-z-]+)\]$/.exec(selector);
        if (!attribute) return [];
        const name = attribute[1]; // Exactly the editor's data-attribute selectors, not a general-purpose HTML parser.
        const nameJs = name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        const found = [];
        const matchValue = new RegExp('data-' + name + '="([^"]+)"', 'g');
        for (const match of html.matchAll(matchValue)) {
          const node = element('', { [nameJs]: match[1] });
          node.checked = /\bchecked(?:\s|>|$)/.test(html.slice(match.index, match.index + 160));
          found.push(node);
        }
        lookup.set(selector, found);
        return found;
      },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
  }; // Provides only the IDs and event handlers used by the standalone editor.
  const sample = JSON.parse(JSON.stringify(config)); // UI smoke edits an isolated document, never the fixture shared by other tests.
  const sandboxWindow = { AmbientVocabularyRules: rules };
  vm.runInNewContext(file('docs/config/weapon-trust-visits.js'), { window: sandboxWindow }); // Same unmodified, authored doorstep visitor config shown in the real workshop. // Same rule implementations already executed in the runtime tests.
  const fetch = async url => ({ ok: true, status: 200, json: async () => String(url).includes('ambient-vocabulary.json') ? sample
    : String(url).includes('npc-reaction-profiles.json') ? profiles
    : String(url).includes('ambient-dialogue.json') ? JSON.parse(file('docs/config/dialogue/ambient-dialogue.json'))
    : { npcs: [{ id: 'pahu', name: 'Pahu' }, { id: 'sloomi', name: 'Sloomi' }] } });
  vm.runInNewContext(file('docs/js/ambient-vocabulary-editor.js'), { window: sandboxWindow, document, fetch });
  for (let i = 0; i < 16; i++) await Promise.resolve(); // Resolve the same three configuration requests used during real editor boot.
  const panel = document.getElementById('editor');
  const sidebar = document.getElementById('list');
  assert.ok(panel.innerHTML.includes('Master synonym dictionary'), 'Standalone dictionary should load on its own');
  const chooseNpc = sidebar.querySelectorAll('[data-entry]').find(node => node.dataset.entry === 'npc:pahu');
  assert.ok(typeof chooseNpc?.onclick === 'function', 'NPC chooser must be interactive');
  chooseNpc.onclick();
  assert.ok(panel.innerHTML.includes('data-check-synonym='), 'The NPC editor must expose shared synonym checkboxes');
  assert.ok(panel.innerHTML.includes('Authoritative doorstep speech') && panel.innerHTML.includes('moy moind'),
    'Pahu authoring should show real source lines instead of approximate generated pirate examples');
  assert.ok(panel.innerHTML.includes('data-use-visit=') && panel.innerHTML.includes('data-harvest-word='),
    'Doorstep authoring must support original-line previews and safe candidate harvesting');
  assert.equal(sandboxWindow.AmbientVocabularyEditor.getDebug().greetingSamplesLoaded, true);
  assert.equal(sandboxWindow.AmbientVocabularyEditor.getDebug().currentSpeakerSampleCount, 6,
    'Editor must expose Pahu\'s six actual floating greetings as voice audit samples');
  const audition = document.getElementById('sampleAuthoredGreeting');
  assert.ok(typeof audition?.onclick === 'function', 'Mobile users can cycle authored greeting examples without using a console');
  audition.onclick();
  assert.equal(document.getElementById('previewInput').value, 'Ahoy there, {targetName}!!!',
    'Audition samples must come from authored NPC greeting JSON, not generated generic placeholder text');
  audition.onclick();
  assert.equal(document.getElementById('previewInput').value, 'Ahoy, {targetName}! Ye\'ve got a spring in yerr step today!',
    'Successive auditions should cycle real authored lines without changing the dialogue configuration');
  const original = Object.keys(sample.lexicon).sort((a, b) => a.localeCompare(b))[0];
  document.getElementById('checkNone').onclick();
  assert.equal(sample.characters.pahu.selections[original].length, 0, 'Uncheck all must store an explicit empty override');
  document.getElementById('checkAll').onclick();
  assert.equal(sample.characters.pahu.selections[original].length, sample.lexicon[original].length, 'Check all must reference every master synonym ID');
  assert.equal(Object.hasOwn(sample.characters.pahu, 'table'), false, 'Checkbox operations must not copy synonym text');
  const slider = panel.querySelectorAll('[data-axis]').find(node => node.dataset.axis === 'verbosity');
  assert.ok(slider?.oninput, 'NPC verbosity slider should be interactive');
  slider.value = '93';
  slider.oninput();
  assert.equal(sample.characters.pahu.sliders.verbosity, 93, 'Slider changes must reach the correct NPC');

  const chooseMaster = sidebar.querySelectorAll('[data-entry]').find(node => node.dataset.entry === 'dictionary');
  chooseMaster.onclick();
  const candidate = sample.lexicon[original][0];
  const stableId = candidate.id;
  const input = panel.querySelectorAll('[data-edit-synonym]').find(node => node.dataset.editSynonym === stableId);
  assert.ok(input?.onchange, 'Master synonym edits must be interactive');
  input.value = 'canonical replacement for testing';
  input.onchange();
  const kindInput = panel.querySelectorAll('[data-edit-kind]').find(node => node.dataset.editKind === stableId);
  assert.ok(kindInput?.onchange, 'Master synonym category control must be interactive');
  kindInput.value = 'old-slang';
  kindInput.onchange();
  const yearInput = panel.querySelectorAll('[data-edit-period]').find(node => node.dataset.editPeriod === stableId);
  assert.ok(yearInput?.onchange, 'Historical cutoff year must be editable');
  yearInput.value = '1850';
  yearInput.onchange();
  assert.equal(sample.lexicon[original][0].kind, 'old-slang', 'Style control must modify the canonical entry');
  assert.equal(sample.lexicon[original][0].firstRecorded, 1850, 'Year control must retain valid pre-1900 dates');
  yearInput.value = '1930';
  yearInput.onchange();
  assert.equal(sample.lexicon[original][0].firstRecorded, 1850, 'Editor rejects later historical slang attestation dates');
  assert.equal(sample.lexicon[original][0].id, stableId, 'Renaming a synonym must preserve the stable ID');
  assert.equal(sample.lexicon[original][0].text, 'canonical replacement for testing');
  assert.ok(sample.characters.pahu.selections[original].includes(stableId), 'Renaming a global entry must preserve character checkmarks');
  assert.ok(rules.resolveSelections(sample.lexicon, sample.characters.pahu.selections)[original]
    .includes('canonical replacement for testing'), 'One shared text update must affect character vocabulary');

  chooseNpc.onclick(); // The old sidebar node is deliberately re-used to ensure selecting a different pane remains safe.
  assert.ok(panel.innerHTML.includes('canonical replacement for testing'), 'NPC checkboxes must display the updated canonical word');
  assert.equal(sandboxWindow.AmbientVocabularyEditor.getDebug().characterOverrides, Object.keys(config.characters).length, 'The workshop must preserve all pre-authored character profiles while editing Pahu');
  const harvestButton = panel.querySelectorAll('[data-harvest-word]')[0];
  assert.ok(harvestButton?.onclick, 'Doorstep candidate words must be actionable on mobile');
  const harvestedWord = harvestButton.dataset.harvestWord;
  harvestButton.onclick();
  assert.deepEqual(plain(sample.lexicon[harvestedWord]), [], 'Harvesting must create only an empty canonical entry, never invent synonyms');
  assert.ok(panel.innerHTML.includes('Master synonym dictionary'), 'Harvested word should open the real master dictionary');
  const voiceTab = sidebar.querySelectorAll('[data-entry]').find(node => node.dataset.entry === 'voice:pahu');
  assert.ok(voiceTab?.onclick, 'Pahu voice group must be independently editable');
  voiceTab.onclick();
  assert.ok(panel.innerHTML.includes('phoneticPairs'), 'Pahu voice must show the phonetic rule editor');
  document.getElementById('phoneticPairs').value = 'I | oy\nmy | moy';
  document.getElementById('savePhonetics').onclick();
  assert.equal(sample.phoneticPresets.pahu_grapple_flail.rules.length, 2);
  assert.equal(rules.applyPhoneticPreset('I have my things.', sample, 'pahu_grapple_flail', 'pahu').text,
    'Oy have moy things.', 'Edited phonetic rules must take effect without a reload');
}

async function testFamilyBabyAmbient() {
  let day = 10; // Simulated in-game calendar; validates exact newborn-to-toddler boundary.
  const assigned = new Map(); // Captures the real RomanceFamily calls into AmbientDialogue's runtime-child greeting pool.
  const familyWindow = {
    addEventListener() {},
    AmbientDialogue: { setNpcGreetings(id, lines) { if (lines) assigned.set(id, lines); else assigned.delete(id); return true; } },
    DialogueContent: { registerTreeProvider() {} },
  }; // Tiny real-module host: only the existing family/ambient interfaces are stubbed.
  vm.runInNewContext(file('docs/config/romance-config.js'), { window: familyWindow });
  vm.runInNewContext(file('docs/js/family-baby-ambient-voice.js'), { window: familyWindow }); // Load the extracted baby voice bridge exactly as game index does.
  vm.runInNewContext(file('docs/js/romance-family.js'), {
    window: familyWindow, console,
    setTimeout: () => 1, clearTimeout: () => {}, // Deterministic browser timers; restore() cancels legacy announcement timeouts.
    performance: { now: () => 0 }, // Family growth tests inspect saved calendar transitions without depending on wall-clock animation.
  });
  const family = familyWindow.RomanceFamily;
  const child = { id: 'child_babble_fixture', name: 'Pip', bornRawDay: 10, gender: 'male', speciesId: 'mao-ao' };
  family.init({ helpers: {
    rawDay: () => day,
    cfg: () => familyWindow.SCRATCHBONES_CONFIG.game.romance,
    deps: () => ({}),
  }, getSpouse: () => null });
  family.restore({ children: [child] });
  const sounds = familyWindow.HobunjiRomanceConfig.family.babyAmbientNoises;
  assert.ok(sounds.length >= 6 && sounds.every(text => /^[A-Za-z?! .-]+$/.test(text)),
    'Newborn ambient sounds must be speech-like syllables, not narrative stage directions or actual adult sentences');
  assert.equal(family.isBasketBaby(child.id), true);
  assert.equal(family.babyAmbientSound(child.id, () => 0), sounds[0]);
  assert.equal(family.babyAmbientSound(child.id, () => 0.9999), sounds.at(-1));
  assert.equal(family.babyAmbientSound('gantami_ginju'), null, 'Only the player\'s saved infant has baby babble');
  assert.equal(family._test.childRecord(child).ambientGreetings, true, 'Basket babies should no longer be mute in ambient greetings');
  assert.deepEqual(plain(assigned.get(child.id).player), plain(sounds), 'Newborn registers only the short phonetic pool');
  day = 10 + 27;
  assert.equal(family.isBasketBaby(child.id), true, 'Last basket day must still be newborn-only');
  day = 10 + 28;
  assert.equal(family.isBasketBaby(child.id), false, 'The first toddler day stops baby-phonetic overrides immediately');
  assert.equal(family.babyAmbientSound(child.id, () => 0), null, 'Toddlers no longer use baby sounds');
  family._test.syncChildAmbientGreetings(child);
  assert.deepEqual(plain(assigned.get(child.id).player), plain(familyWindow.HobunjiRomanceConfig.family.toddlerAmbientGreetings),
    'Toddler transitions to short, age-appropriate first-word greetings without a restart');
  assert.equal(family._test.childRecord(child).ambientGreetings, true, 'Toddler floating greetings stay enabled');
  day = 10 + 168;
  family._test.syncChildAmbientGreetings(child);
  assert.ok(assigned.get(child.id).player.includes('Can we play later?'), 'Older child returns to the established child greeting pool');
  family.restore({ children: [] });
  assert.equal(assigned.has(child.id), false, 'World/character changes remove old child greeting pools');
  const ambientSource = file('docs/js/ambient-dialogue.js');
  assert.ok(ambientSource.includes('!isNewborn && options.vocabulary !== false'), 'Baby babble bypasses all adult synonym and regional dialogue');
  assert.ok(ambientSource.includes('babyAmbientSound?.(speakerId)'), 'Automatic proximity greetings take their speech from authoritative family stage');
  assert.ok(ambientSource.includes('babyAnchor?.group || walker.root'), 'Held newborn greetings use the visible carry proxy rather than the hidden walker');
  assert.ok(ambientSource.includes('FamilyBabyAmbientVoice?.anchorFor'), 'Carried baby anchors must go through the independent voice adapter');
  assert.ok(ambientSource.includes('runtimeGreetings'), 'Dynamic family greeting pools must survive the async ambient configuration load');
  assert.ok(!file('docs/js/dialogue-content.js').includes('babyAmbientSound'), 'The ordinary Talk renderer is not replaced by ambient baby noises');
}

async function main() {
  vm.runInContext(file('docs/js/ambient-vocabulary-rules.js'), context);
  vm.runInContext(file('docs/js/ambient-vocabulary.js'), context);
  for (let i = 0; i < 12; i++) await Promise.resolve(); // Flush the real module's async fetch and JSON continuations.
  const engine = window.AmbientVocabulary;
  const rules = window.AmbientVocabularyRules;
  assert.equal(engine.getDebug().ready, true, engine.getDebug().error);
  assert.ok(Object.keys(config.lexicon).length >= 30);
  const beforeUnmatched = engine.getDebug().cachedSpeakers;
  assert.equal(engine.rewrite('Arf! Rrruf!', 'test-wildlife-1'), 'Arf! Rrruf!');
  assert.equal(engine.getDebug().cachedSpeakers, beforeUnmatched, 'Unmatched animal speech must not allocate NPC vocabulary tables');
  for (let index = 0; index < 145; index++) engine.rewrite('Lovely tune!', 'test-speaker-' + index, () => 0);
  assert.ok(engine.getDebug().cachedSpeakers <= 128, 'Speaker cache must be bounded in crowded scenes');
  for (const [id, family] of Object.entries(config.families)) {
    assert.ok(profiles.profiles[id] || id === 'porakaneki', 'Unexpected vocabulary-only personality family: ' + id); // Generated Porakaneki hunters use a distinct vocabulary preset, not a fake reaction profile.
    for (const axis of Object.keys(rules.DEFAULT_SLIDERS)) {
      assert.ok(Number.isFinite(family.sliders[axis]), id + ' is missing ' + axis);
    }
  }
  const explicit = {
    enabled: true,
    lexicon: {
      lovely: [{ id: 'pleasant', text: 'pleasant', verbosity: 30, color: 20, formality: 60 },
        { id: 'splendid', text: 'splendid', verbosity: 80, color: 80, formality: 80 }],
      'good to see you': [{ id: 'glad', text: 'glad to see you', verbosity: 40, color: 30, formality: 40 },
        { id: 'delighted', text: 'delighted to see you', verbosity: 90, color: 90, formality: 85 }],
    },
    families: { neighborly: { sliders: { frequency: 100, variety: 100 } } },
    characters: { pahu: { sliders: { frequency: 100 }, selections: { lovely: ['splendid'], 'good to see you': ['delighted'] } } },
  };
  const assignments = { defaultProfile: 'neighborly', assignments: { pahu: 'neighborly' } };
  assert.equal(engine.rewrite('Lovely, LOVELY!', 'pahu', () => 0, explicit, assignments), 'Splendid, SPLENDID!');
  assert.equal(engine.rewrite('Good to see you, {targetName}! {{playerName}} is lovely.', 'pahu', () => 0, explicit, assignments),
    'Delighted to see you, {targetName}! {{playerName}} is splendid.');
  assert.equal(engine.rewrite('unlovely lovely friendship', 'pahu', () => 0, explicit, assignments),
    'unlovely splendid friendship'); // Only complete words, not substrings.
  assert.equal(engine.rewrite('Lovely', 'player', () => 0, explicit, assignments), 'Lovely');
  assert.equal(engine.rewrite('Lovely', 'player-progression', () => 0, explicit, assignments), 'Lovely');
  assert.equal(engine.rewrite('Lovely', null, () => 0, explicit, assignments), 'Lovely');
  assert.equal(engine.rewrite('Lovely', 'pahu', () => 0.999, {
    ...explicit, characters: { pahu: { sliders: { frequency: 0 }, selections: { lovely: ['splendid'] } } },
  }, assignments), 'Lovely'); // Authored fallback is always available.
  assert.notEqual(JSON.stringify(rules.seedSliders(config.families.playful.sliders, 'pahu')),
    JSON.stringify(rules.seedSliders(config.families.playful.sliders, 'sloomi'))); // Same family, distinct stable individual vocabulary axes.
  assert.deepEqual(rules.seedSliders(config.families.playful.sliders, 'pahu'),
    rules.seedSliders(config.families.playful.sliders, 'pahu')); // Restored sessions do not change a character's vocabulary.
  assert.equal(config.schema, 'hobunji_ambient_vocabulary.v2');
  for (const [word, alternatives] of Object.entries(config.lexicon)) {
    assert.ok(Array.isArray(alternatives) && alternatives.every(entry => typeof entry.id === 'string' && entry.id));
    assert.equal(new Set(alternatives.map(entry => entry.id)).size, alternatives.length, 'Duplicate IDs in ' + word);
  }
  assert.ok(Object.keys(config.lexicon).length >= 75, 'The expanded master dictionary should include broad everyday source vocabulary');
  assert.ok(Object.values(config.lexicon).flat().length >= 275, 'The expanded dictionary needs enough alternatives for distinct voices');
  const historical = Object.values(config.lexicon).flat().filter(entry => entry.kind === 'old-slang');
  assert.ok(historical.length >= 18, 'Old slang should be a substantial, separately selectable style');
  assert.ok(historical.every(entry => Number.isInteger(entry.firstRecorded) && entry.firstRecorded < 1900 && /^https:\/\//.test(entry.source)),
    'Every historically labeled slang term requires a traceable, pre-1900 attestation');
  assert.ok(config.lexicon.nonsense.some(entry => entry.text === 'balderdash' && entry.kind === 'old-slang'));
  assert.ok(config.lexicon.deceive.some(entry => entry.text === 'bamboozle'));
  assert.ok(config.lexicon['run away'].some(entry => entry.text === 'skedaddle')); // Historically attested phrase replacement.
  const countKinds = (id, family) => {
    const sliders = rules.seedSliders(config.families[family].sliders, id);
    const chosen = rules.generateSelections(config.lexicon, sliders, id);
    const counts = { standard: 0, 'old-slang': 0, simple: 0, 'near-miss': 0 };
    for (const [word, refs] of Object.entries(chosen)) {
      for (const candidateId of refs) {
        const entry = config.lexicon[word].find(candidate => candidate.id === candidateId);
        assert.ok(entry, 'Generated ID must exist in the shared catalog');
        counts[entry.kind || 'standard']++;
      }
    }
    return counts;
  };
  assert.ok(countKinds('porakaneki_chief', 'porakaneki')['old-slang'] >= 5, 'Porakaneki chief should use pre-1900 slang');
  assert.ok(countKinds('porakaneki_small_map_test_0:resident:0', 'porakaneki')['old-slang'] >= 5, 'Generated hunters need the tribe preset');
  assert.ok(countKinds('child_test123', 'child').simple >= 10 && countKinds('child_test123', 'child')['near-miss'] >= 8,
    'Children should use obvious simple and almost-right words');
  for (const family of ['neighborly', 'playful', 'proper', 'reserved', 'stern']) {
    const counts = countKinds('village_' + family, family);
    assert.equal(counts['old-slang'] + counts.simple + counts['near-miss'], 0,
      'Unconfigured adults must not inherit old slang or childlike malaprops');
  }
  assert.ok(!rules.generateSelections({ nonsense: [{ id: 'too-new', text: 'modernism', kind: 'old-slang', firstRecorded: 1901 }] },
    { oldSlang: 100, breadth: 100, variety: 100 }, 'porakaneki_chief').nonsense,
    'Post-1899 slang must not be automatically generated');
  assert.equal(rules.resolveSelections({ nonsense: [{ id: 'too-new', text: 'modernism', kind: 'old-slang', firstRecorded: 1901 }] },
    { nonsense: ['too-new'] }).nonsense, undefined, 'Manual checkmarks cannot override the historical cutoff');
  assert.equal(rules.resolveSelections({ nonsense: [{ id: 'undated', text: 'invented-era-slang', kind: 'old-slang' }] },
    { nonsense: ['undated'] }).nonsense, undefined, 'Undated slang must remain inactive until dated in the editor');
  const manualSlang = rules.resolveSelections(config.lexicon, { nonsense: ['balderdash'] });
  assert.ok(manualSlang.nonsense.includes('balderdash'), 'Manual checkmarks always honor the master list regardless of sliders');
  const chiefSpeech = engine.rewrite('Go way. No want trouble', 'porakaneki_chief', () => 0);
  assert.ok(chiefSpeech.startsWith('Skedaddle.'), 'Real Porakaneki warning text must use its pre-1900 slang in the RUNTIME, not only the generator');
  const childSpeech = engine.rewrite("I'm hungry.", 'child_test123', () => 0);
  assert.equal(childSpeech, "I'm tummy-rumbly.", 'Real child speech must use the generated simplicity/near-miss axes in the RUNTIME');
  const everydaySpeech = engine.rewrite('Nonsense!', 'ordinary_neighbor', () => 0);
  assert.equal(everydaySpeech, 'Nonsense!', 'Unassigned villagers must not receive Pahu or Ginju historical slang');
  engine.rewrite('Friend!', 'porakaneki_chief', () => 0);
  assert.equal(engine.getDebug().last.familyId, 'porakaneki', 'The named chief uses the tribal vocabulary family');
  engine.rewrite('Friend!', 'porakaneki_small_map_test_0:resident:0', () => 0);
  assert.equal(engine.getDebug().last.familyId, 'porakaneki', 'Dynamically generated hunters use the same tribal vocabulary family');
  engine.rewrite('Friend!', 'child_test123', () => 0);
  assert.equal(engine.getDebug().last.familyId, 'child', 'Generated children inherit the child family');
  const suggestions = rules.generateSelections(config.lexicon, config.families.playful.sliders, 'pahu');
  assert.ok(Object.keys(suggestions).length >= 15, 'Broad vocabulary must cover numerous source words');
  assert.deepEqual(suggestions, rules.generateSelections(config.lexicon, config.families.playful.sliders, 'pahu'));
  const generated = rules.resolveSelections(config.lexicon, suggestions);
  assert.ok(Object.keys(generated).length >= 15);
  const fullySelected = { lovely: config.lexicon.lovely.map(entry => entry.id) };
  const edited = rules.mergeSelections(suggestions, fullySelected);
  assert.deepEqual(plain(edited.lovely), fullySelected.lovely);
  const disabled = rules.mergeSelections(edited, { lovely: [] });
  assert.deepEqual(plain(disabled.lovely), []);
  assert.equal(rules.resolveSelections(config.lexicon, disabled).lovely, undefined, 'Explicit empty list disables substitutions');
  const canonical = { lovely: [{ id: 'one', text: 'pretty', verbosity: 20, color: 50, formality: 40 },
    { id: 'two', text: 'splendid', verbosity: 80, color: 70, formality: 85 }] };
  const refs = { lovely: ['two'] };
  assert.deepEqual(plain(rules.resolveSelections(canonical, refs).lovely), ['splendid']);
  canonical.lovely[1].text = 'magnificent';
  assert.deepEqual(plain(rules.resolveSelections(canonical, refs).lovely), ['magnificent']); // Editing the master list updates all checked characters without copying alternatives.
  assert.deepEqual(plain(rules.resolveSelections(canonical, { lovely: ['unknown'] })), {}); // Deleted synonyms cannot become ghost replacements.
  assert.deepEqual(plain(rules.migrateLegacyTable(canonical, { lovely: ['magnificent'] })), { lovely: ['two'] });
  assert.equal(rules.rewriteLine('a lovely tune', { lovely: ['amazing','wonderful'] },
    { frequency: 100, variety: 100 }, () => 0, 'pahu').text, 'a wonderful tune'); // a/an agreement.
  assert.equal(rules.rewriteLine('an lovely tune', { lovely: ['amazing','wonderful'] },
    { frequency: 100, variety: 100 }, () => 0, 'pahu').text, 'an amazing tune');
  assert.equal(rules.rewriteLine('a lovely tune', { lovely: ['amazing'] },
    { frequency: 100 }, () => 0, 'pahu').text, 'a lovely tune'); // Invalid article agreement falls back to authored text.
  assert.equal(rules.rewriteLine('lovely {targetName} friend', { lovely: ['nice'], friend: ['pal'] },
    { frequency: 100, variety: 100 }, () => 0, 'pahu').text, 'nice {targetName} pal');
  assert.equal(rules.rewriteLine('lovelier friendship', { lovely: ['nice'], friend: ['pal'] },
    { frequency: 100, variety: 100 }, () => 0, 'pahu').text, 'lovelier friendship'); // No substrings.
  const narrow = rules.generateSelections(config.lexicon,
    { verbosity: 10, color: 10, formality: 10, breadth: 0, variety: 0 }, 'pahu');
  assert.ok(Object.keys(narrow).every(key => narrow[key].length <= 1)); // Consistent speakers choose one synonym per word.
  // The source of each regional style stays the one canonical doorway speech, not an AI-generated accent.
  const visitContext = { window: {} };
  vm.runInNewContext(file('docs/config/weapon-trust-visits.js'), visitContext);
  const visits = visitContext.window.WEAPON_TRUST_VISIT_CONFIG.gifts;
  const pahuVisit = visits.find(gift => gift.npcId === 'pahu');
  assert.ok(pahuVisit?.dialogueLines?.some(line => line.includes('moy moind') && line.includes('Ahoy')),
    'Pahu phonetics must trace to the actual, fully authored Grapple-Flail doorstep visit');
  assert.ok(visits.some(gift => gift.npcId === 'hreesh' && gift.dialogueLines.length >= 10), 'Hreesh authored visit supplies vocabulary too');
  assert.ok(visits.some(gift => gift.npcId === 'kzubug' && gift.dialogueTree.nodes.length >= 8), 'Kzubug branches must be harvestable');
  for (const [source, word] of [['hreesh_kylie','clobber'],['kzubug_plainssword','folk'],['pahu_grapple_flail','arm']]) {
    assert.ok(Object.values(config.lexicon).flat().some(entry => entry.sourceVisit === source && entry.text === word),
      'The master dictionary should seed this authored doorstep vocabulary: ' + source + ':' + word);
  }
  assert.ok(config.speakerGroups.ginju.speakerIds.every(id => profiles.assignments[id]),
    'Ginju group must reuse existing NPC identities and personalities');
  assert.equal(config.speakerGroups.pahu.phoneticPreset, 'pahu_grapple_flail');
  assert.ok(config.phoneticPresets.pahu_grapple_flail.rules.length >= 30);
  assert.deepEqual(plain(rules.speakerTraits(config, 'pahu').dialects), ['west-country','pirate']);
  assert.deepEqual(plain(rules.speakerTraits(config, 'gikali_ginju').dialects), ['southeastern-us']);
  assert.equal(rules.speakerTraits(config, 'sloomi').groupId, null, 'Unrelated villagers must never get a regional dialect');
  for (const id of config.speakerGroups.ginju.speakerIds) {
    const southern = engine.rewrite("I'm not sure you all are ready.", id, () => 0);
    assert.ok(southern.includes("I ain't") && southern.includes("y'all"), id + ' should use Southern contractions');
    assert.equal(engine.getDebug().last.dialectGroup, 'ginju', id + ' retains family voice group');
    assert.equal(engine.getDebug().last.familyId, profiles.assignments[id], 'Ginju regional voice cannot replace their individual personality');
  }
  const pahusHello = engine.rewrite('Hello, my friend.', 'pahu', () => 0);
  assert.equal(pahusHello, 'Ahoy, moy matey.', 'Pahu should combine nautical words with authored first-person spelling');
  const pahusEveryday = engine.rewrite('I am getting my things together.', 'pahu', () => 0);
  assert.equal(pahusEveryday, "Oym gettin' moy things together.", 'Pahu phonetic pass runs even when the semantic dictionary matches nothing');
  assert.equal(engine.rewrite('I am getting my things together.', 'sloomi', () => 0),
    'I am getting my things together.', 'Pahu phonetics never touch ordinary NPCs');
  assert.equal(engine.rewrite('I will tell {targetName} and <lad/lass> that you are here.', 'pahu', () => 0)
    .includes('<lad/lass>'), true, 'Phonetic changes must preserve both NPC placeholders and angled doorstep tokens');
  assert.equal(rules.rewriteLine("I'm fine.", { "i'm": ['I am'] }, { frequency: 100 }, () => 0, 'pahu').text,
    'I am fine.', 'Unicode phrase matching supports apostrophe contractions');
  assert.ok(!rules.generateSelections({ hello: [{ id: 'howdy', text: 'howdy', kind: 'regional', dialect: 'southeastern-us' }] },
    { breadth: 100, variety: 100 }, 'pahu', ['west-country','pirate']).hello,
    'West Country generators must not select Southeastern forms');
  assert.ok(!rules.generateSelections({ hello: [{ id: 'untagged', text: 'regional word', kind: 'regional' }] },
    { breadth: 100, variety: 100 }, 'pahu', ['west-country']).hello,
    'A regional word with no dialect label must never leak into automatic tables');
  // Voice authoring audit: compare the LIVE floating renderer against source NPC bios,
  // authored phrase pools, reaction personalities, and their own greetings.
  const roster = JSON.parse(file('docs/config/npcs/hobunji-starter-npc-database.json')).npcs; // Source-of-truth NPC bios and phrase pools.
  const records = new Map(roster.map(npc => [npc.id, npc])); // Used only to validate hand-authored character voices in this regression.
  const greetings = JSON.parse(file('docs/config/dialogue/ambient-dialogue.json')).npcGreetings; // Actual random floating greetings, not synthetic examples.
  const nativeLines = id => records.get(id).phrasePools
    .filter(pool => /greetings/i.test(pool.name)).flatMap(pool => pool.entries.map(entry => entry.text));
  assert.equal(records.get('pahu').ageBand, 'old');
  assert.match(records.get('pahu').bio, /silly and warm.*Leaf/i);
  assert.match(records.get('gorobi_ginju').bio, /proud.*competitive/i);
  assert.match(records.get('gikali_ginju').bio, /kind-hearted but anxious/i);
  assert.match(records.get('aliri_ginju').bio, /dutiful.*competitive/i);
  assert.ok(nativeLines('aliri_ginju').some(line => line.includes("How's it goin'?")),
    'Aliri has casual, teasing greetings and must not be configured with stiff proper reactions');
  assert.equal(profiles.assignments.aliri_ginju, 'playful', 'Aliri shares the playful reaction family; her own vocabulary is independently tuned');
  assert.match(records.get('gantami_ginju').bio, /mischievous little brother/i);
  for (const id of ['pahu','gorobi_ginju','gikali_ginju','aliri_ginju','gantami_ginju']) {
    assert.ok(greetings[id].player.length >= 5, 'Author multiple grounded random greetings for ' + id);
    assert.ok(config.characters[id]?.sliders && Object.keys(config.characters[id].sliders).length >= 3,
      'Individual NPC voice sliders must be tuned for ' + id);
    for (const line of [...greetings[id].player, ...nativeLines(id)]) {
      for (const chance of [0, 0.3, 0.75, 0.98]) {
        const output = engine.rewrite(line, id, () => chance);
        const protectedTerms = line.match(/\{\{[^{}]*\}\}|\{[A-Za-z][A-Za-z0-9_]*\}|<[^<>\n]{1,80}>/g) || [];
        for (const term of protectedTerms) assert.ok(output.includes(term),
          'The voiced line must preserve literal authored tokens (' + id + '): ' + term);
        assert.ok(!/\b(?:a not safe|an not safe|you without question|i i ain't|my my)\b/i.test(output),
          'Avoid semantics/grammar regressions in ' + id + ': ' + output);
      }
    }
  }
  const voiceCases = [
    ['pahu', "Isn't it time to fight?", "Ain't it toime to foight?"],
    ['pahu', 'I am getting my things together.', "Oym gettin' moy things together."],
    ['gikali_ginju', "It's good to see you, my friend.", "It's nice to see you, my friend."],
    ['aliri_ginju', 'You certainly have spirit.', 'You sure have spirit.'],
    ['gantami_ginju', "I am not very happy about that terrible weather.", "I ain't very glad about that very bad weather."],
    ['leaf', "At least they're quiet.", "At least they're quiet."],
    ['hreesh', "It's good to see you, friend.", "It's good to see you, friend."],
    ['kzubug', 'Good to see you safe, {targetName}.', 'Good to see you safe, {targetName}.'],
    ['jubmir', "It's good to see you, my friend.", "It's a pleasure to see you, my friend."],
  ];
  for (const [npcId, authored, expected] of voiceCases) {
    assert.equal(engine.rewrite(authored, npcId, () => 0), expected, 'Voice snapshot for ' + npcId);
  }
  assert.equal(engine.rewrite('The weather is terrible.', 'gorobi_ginju', () => 0).includes('The weather is'), true,
    'Changing weather to plural "elements" would break sentence agreement');
  assert.ok(!engine.rewrite('Not right now.', 'gikali_ginju', () => 0).includes('maybe later'),
    'A refusal must not become an implicit promise');
  assert.ok(!Object.hasOwn(config.lexicon, 'weather'), 'Remove synonym roots that cannot keep subject agreement');
  assert.ok(!config.lexicon.quiet.some(entry => entry.text === 'peaceful'),
    'Quiet ambient sound is not automatically the same as peaceful mood');
  // Source-backed coverage: actual random NPC greetings and every tier of each personality's pet reactions.
  const greetingChanges = Object.entries(greetings).flatMap(([id, pool]) => (pool.player || []).map(line =>
    engine.rewrite(line, id, () => 0) !== line)); // One deterministic high-probability roll per real authored greeting.
  assert.ok(greetingChanges.filter(Boolean).length >= 23, 'Ordinary NPC greetings must offer visible vocabulary choices');
  const petSpeakerByFamily = { neighborly: 'furunji_funji', playful: 'gorobi_ginju', reserved: 'sloomi',
    proper: 'kzubug', stern: 'leaf', child: 'gantami_ginju' }; // Each test NPC has an actual matching reaction profile.
  const petPoolLines = profile => {
    const lines = []; // Collect actual authored tiers, roles, and recognition responses without rewriting reaction config.
    const collect = value => {
      if (Array.isArray(value)) lines.push(...value);
      else if (value && typeof value === 'object') Object.values(value).forEach(collect);
    };
    collect(profile.animal);
    return lines;
  };
  let changedPetLines = 0; // Total pet responses with an available lexical change across all personality owners.
  for (const [family, npcId] of Object.entries(petSpeakerByFamily)) {
    assert.equal(profiles.assignments[npcId], family, 'Pet test NPC must keep its real personality: ' + npcId);
    const sources = petPoolLines(profiles.profiles[family]);
    const rendered = sources.map(line => engine.rewrite(line, npcId, () => 0));
    const changed = rendered.filter((text, index) => text !== sources[index]).length;
    assert.ok(changed >= 2, 'Pet reactions must visibly vary for ' + family);
    changedPetLines += changed;
    for (let index = 0; index < sources.length; index++) {
      for (const placeholder of sources[index].match(/\{[A-Za-z][A-Za-z0-9_]*\}/g) || []) {
        assert.ok(rendered[index].includes(placeholder), 'Pet name/species token must survive: ' + placeholder);
      }
    }
  }
  assert.ok(changedPetLines >= 35, 'Pet reactions must visibly vary across the real personality pools');
  assert.equal(engine.rewrite('Hi!', 'gantami_ginju', () => 0), 'Hiya!');
  assert.equal(engine.rewrite('Howdy there, partner!', 'gorobi_ginju', () => 0), 'Well, howdy, partner!');
  assert.equal(engine.rewrite('Howdy-hey, {targetName}!', 'aliri_ginju', () => 0), 'Hey-howdy, {targetName}!');
  assert.equal(engine.rewrite('Good morning, {targetName}!', 'jubmir', () => 0), 'Lovely morning, {targetName}!');
  assert.equal(engine.rewrite('Good to see you safe, {targetName}.', 'kzubug', () => 0),
    'Good to see you safe, {targetName}.', 'A generic word cannot undermine Kzubug');
  assert.equal(engine.rewrite('Hey...', 'leaf', () => 0), 'Hey...', 'Leaf must remain terse');
  assert.equal(engine.rewrite('Hey, {animalName}!', 'gorobi_ginju', () => 0), 'Hiya, {animalName}!');
  assert.equal(engine.rewrite('Kitty!', 'gantami_ginju', () => 0), 'Kit-cat!');
  assert.equal(engine.rewrite('Hi!', 'gantami_ginju', () => 0.99), 'Hi!', 'Probability retains authored fallback');
  const beforePetNoiseCache = engine.getDebug().cachedSpeakers; // Unmatched pet sounds should never allocate new tables.
  engine.rewrite('Neeeeeeyyy!!!!', 'gantami_ginju', () => 0);
  const noiseDebug = engine.getDebug();
  assert.equal(noiseDebug.last.reason, 'no-dictionary-phrase', 'Diagnostics must describe the newest unmatched bubble');
  assert.equal(noiseDebug.cachedSpeakers, beforePetNoiseCache);
  assert.ok(noiseDebug.recent.length <= 12 && noiseDebug.recent.some(entry => entry.reason === 'reworded'));
  // Whole-pool language audit: a lexical change is not useful if it produces awkward grammar or corrupts a named token.
  const allFloatingSource = Object.entries(greetings).flatMap(([npcId, greetingPool]) =>
    (greetingPool.player || []).map(line => [npcId, line])); // One entry for each actual NPC greeting.
  for (const [family, npcId] of Object.entries(petSpeakerByFamily)) {
    allFloatingSource.push(...petPoolLines(profiles.profiles[family]).map(line => [npcId, line]));
  } // The same source pool also includes every role/tier of the six pet personalities.
  const testRolls = [0, 0.05, 0.2, 0.49, 0.75, 0.99]; // Covers multiple synonym choices and chance-to-leave-original paths.
  for (const [npcId, authored] of allFloatingSource) {
    const tokens = authored.match(/\{[A-Za-z][A-Za-z0-9_]*\}/g) || [];
    for (const chance of testRolls) {
      const spoken = engine.rewrite(authored, npcId, () => chance);
      assert.ok(tokens.every(token => spoken.includes(token)), 'All variants must retain placeholders: ' + npcId + ':' + spoken);
      assert.ok(!/(?:hello-hello|how much time has|fine to see you)/i.test(spoken),
        'Vocabulary must avoid known unnatural greeting/pet substitutions: ' + npcId + ':' + spoken);
    }
  }
  assert.equal(engine.rewrite('Hey-hey {targetName}!', 'takua_ao_hakaru', () => 0),
    'Hey there {targetName}!', 'Whole repeated greeting must take priority over separately rewritten hey words');
  assert.equal(engine.rewrite('How long has {animalName} been up there?', 'gorobi_ginju', () => 0),
    "How long's {animalName} been up there?", 'Duration question must keep its interrogative grammar');
  assert.equal(engine.rewrite('I didn\'t know a {species} could be that tiny.', 'furunji_funji', () => 0),
    'I didn\'t know a {species} could be so small.', 'Pet surprise remains idiomatic');
  assert.equal(engine.rewrite('I\'ve never seen a {species} that big.', 'furunji_funji', () => 0),
    'I\'ve never seen a {species} so big.', 'Big animal comparison remains idiomatic');
  assert.equal(engine.rewrite('That {species} is bigger than most.', 'furunji_funji', () => 0),
    'That {species} is larger than most.', 'Comparative retains its meaning');
  assert.equal(config.lexicon['how long'], undefined, 'Unsafe general duration replacement must not remain as a fallback');
  assert.equal(engine.rewrite('Hi, Kitty!', 'gantami_ginju', () => 0, config, profiles, ['Kitty']), 'Hiya, Kitty!');
  assert.equal(engine.rewrite('Good morning, Hi!', 'jubmir', () => 0, config, profiles, ['Hi']), 'Lovely morning, Hi!');
  assert.equal(engine.rewrite('Hey, Ki[t]y!', 'gantami_ginju', () => 0, config, profiles, ['Ki[t]y']), 'Hiya, Ki[t]y!');
  assert.equal(engine.rewrite('Hey, Kitty! {{AMBIENT_VOCAB_NAME_0}}', 'gantami_ginju', () => 0, config, profiles, ['Kitty']),
    'Hiya, Kitty! {{AMBIENT_VOCAB_NAME_0}}');
  assert.equal(engine.rewrite('Hey, Kitty and Hi! {{AMBIENT_VOCAB_NAME_0}}', 'gantami_ginju', () => 0, config, profiles, ['Kitty', 'Hi']),
    'Hiya, Kitty and Hi! {{AMBIENT_VOCAB_NAME_0}}', 'Two protected names cannot reuse the same marker when an authored token occupies marker zero');
  assert.equal(engine.rewrite('Hey, Kitty!', 'gantami_ginju', () => 0, config, profiles, []), 'Hiya, Kit-cat!');
  // Public stable roles provide protected names automatically, including direct pet reactions without new show options.
  window.StableAnimalProgression = { activeEntryForRole: role => role === 'shoulderPet' ? { name: 'Kitty', kind: 'nelk' }
    : role === 'mount' ? { name: 'Hi', kind: 'mount-kind' } : null }; // Fixture mirrors the existing stable API's active-entry shape.
  window.CREATURE_DB = { nelk: { label: 'Nelk' } }; // Canonical species label must also remain untouched.
  assert.equal(engine.rewrite('Hi, Kitty!', 'gantami_ginju', () => 0), 'Hiya, Kitty!',
    'Direct pet remarks protect an active animal name without changing the animal or reaction modules');
  assert.equal(engine.rewrite('Hi, Hi!', 'gantami_ginju', () => 0), 'Hiya, Hi!',
    'Even a pet called Hi must not silence the first greeting word, but its addressed name remains unchanged');
  assert.equal(engine.rewrite('Good morning, Hi!', 'jubmir', () => 0), 'Lovely morning, Hi!',
    'An active animal named Hi keeps its name in floating speech');
  assert.equal(engine.rewrite('Kitty!', 'gantami_ginju', () => 0), 'Kitty!',
    'A named active pet must not turn into an animal noun');
  assert.equal(engine.rewrite('Hey, Nelk!', 'gantami_ginju', () => 0), 'Hiya, Nelk!',
    'Active pet species labels are protected using CREATURE_DB');
  delete window.StableAnimalProgression;
  delete window.CREATURE_DB;
  const debug = engine.getDebug();
  assert.ok(debug.last && Number.isInteger(debug.last.swaps));
  assert.ok(typeof debug.replacements === 'number');

  const floating = file('docs/js/ambient-dialogue.js');
  const regularTalk = file('docs/js/dialogue-content.js');
  assert.ok(floating.includes('window.AmbientVocabulary?.rewrite?.(originalMessage, options.speakerId,'));
  assert.ok(floating.indexOf('window.AmbientVocabulary?.rewrite?.') < floating.indexOf('const textPart = textPlane(message)'));
  assert.ok(floating.includes('showSocialResponse'));
  assert.ok(floating.includes('vocabularyProtectedNames: targetName ? [targetName] : []'));
  assert.ok(floating.includes('options.vocabularyProtectedNames'));
  assert.ok(file('docs/js/ambient-vocabulary.js').includes('Array.isArray(protectedNames) && protectedNames.length'),
    'Unprotected animal cries must bypass extra name-masking allocations');
  assert.ok(file('docs/js/ambient-vocabulary.js').includes('StableAnimalProgression?.activeEntryForRole'),
    'Pet identities must come from the public stable API, not changes to individual reaction callers');
  assert.ok(!file('docs/js/stable-animal-progression.js').includes('vocabularyProtectedNames: [animal.entry?.name'),
    'Stable progression must not depend on vocabulary internals');
  assert.ok(!file('docs/js/npc-silliness-reaction-runtime.js').includes('vocabularyProtectedNames: ['),
    'NPC reactions must not depend on vocabulary internals');
  assert.ok(!regularTalk.includes('AmbientVocabulary')); // The ordinary Talk renderer never invokes word substitution.

  const standalone = file('docs/tools/vocabulary-editor/index.html');
  const hub = file('docs/tools/index.html');
  const ambientTool = file('docs/tools/ambient-dialogue-editor/index.html');
  const editor = file('docs/js/ambient-vocabulary-editor.js');
  assert.ok(standalone.includes('ambient-vocabulary-rules.js') && standalone.includes('ambient-vocabulary-editor.js'));
  assert.ok(hub.includes('data-target="vocabulary-editor"') && hub.includes('id="fw-vocabulary-editor"'));
  assert.ok(!ambientTool.includes('ambient-vocabulary-editor.js'), 'The original Ambient Dialogue Editor must stay uncluttered');
  assert.ok(file('docs/index.html').includes('ambient-vocabulary.js'));
  assert.ok(editor.includes("['verbosity', 'Simplicity', 'Verbosity'"));
  assert.ok(editor.includes("['color', 'Technical', 'Colorful'"));
  assert.ok(editor.includes("['oldSlang', 'No old slang', 'Pre-1900 slang'"));
  assert.ok(editor.includes("['simplicity', 'Normal words', 'Over-simple'"));
  assert.ok(editor.includes("['nearMiss', 'Exact meaning', 'Almost-right'"));
  assert.ok(editor.includes('data-edit-kind') && editor.includes('data-edit-period'), 'Standalone editor must author style classifications and historical dates');
  assert.ok(editor.includes('data-check-synonym') && editor.includes('rules().generateSelections'));
  assert.ok(!editor.includes('data-vocab-table-alternatives'), 'NPC editor must not store duplicate synonym text lists');
  assert.ok(editor.includes('previewResult'));
  new Function('window', editor); // Parse actual integration script even without a browser DOM.
  await testStandaloneEditorInteraction(rules);
  await testFamilyBabyAmbient();
  console.log('Ambient vocabulary tests passed: authored NPC identity snapshots, sampled greetings, regional slang, Pahu phonetics, semantic safeguards, baby/toddler stage transitions, carry speech and editor.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });