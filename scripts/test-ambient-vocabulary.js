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
        const match = /^\\[data-([a-z-]+)="([^"]+)"\\]$/.exec(selector);
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
  const sandboxWindow = { AmbientVocabularyRules: rules }; // Same rule implementations already executed in the runtime tests.
  const fetch = async url => ({ ok: true, status: 200, json: async () => String(url).includes('ambient-vocabulary.json') ? sample
    : String(url).includes('npc-reaction-profiles.json') ? profiles
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
  assert.equal(sample.lexicon[original][0].id, stableId, 'Renaming a synonym must preserve the stable ID');
  assert.equal(sample.lexicon[original][0].text, 'canonical replacement for testing');
  assert.ok(sample.characters.pahu.selections[original].includes(stableId), 'Renaming a global entry must preserve character checkmarks');
  assert.ok(rules.resolveSelections(sample.lexicon, sample.characters.pahu.selections)[original]
    .includes('canonical replacement for testing'), 'One shared text update must affect character vocabulary');

  chooseNpc.onclick(); // The old sidebar node is deliberately re-used to ensure selecting a different pane remains safe.
  assert.ok(panel.innerHTML.includes('canonical replacement for testing'), 'NPC checkboxes must display the updated canonical word');
  assert.equal(sandboxWindow.AmbientVocabularyEditor.getDebug().characterOverrides, 1);
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
    assert.ok(profiles.profiles[id], 'Unrecognized existing personality family: ' + id);
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
  const debug = engine.getDebug();
  assert.ok(debug.last && Number.isInteger(debug.last.swaps));
  assert.ok(typeof debug.replacements === 'number');

  const floating = file('docs/js/ambient-dialogue.js');
  const regularTalk = file('docs/js/dialogue-content.js');
  assert.ok(floating.includes('window.AmbientVocabulary?.rewrite?.(originalMessage, options.speakerId)'));
  assert.ok(floating.indexOf('window.AmbientVocabulary?.rewrite?.') < floating.indexOf('const textPart = textPlane(message)'));
  assert.ok(floating.includes('showSocialResponse'));
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
  assert.ok(editor.includes('data-check-synonym') && editor.includes('rules().generateSelections'));
  assert.ok(!editor.includes('data-vocab-table-alternatives'), 'NPC editor must not store duplicate synonym text lists');
  assert.ok(editor.includes('previewResult'));
  new Function('window', editor); // Parse actual integration script even without a browser DOM.
  await testStandaloneEditorInteraction(rules);
  console.log('Ambient vocabulary tests passed: shared checkbox references, global synonym updates, article agreement, tokens, floating dialogue isolation, standalone editor.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });