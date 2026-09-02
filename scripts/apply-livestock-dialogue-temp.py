from pathlib import Path
import re

source = Path('.github/workflows/sync-animal-chathead-main.yml').read_text()
marker = "          python3 <<'PY'\n"
start = source.index(marker) + len(marker)
end = source.index('\n          PY', start)
raw = source[start:end]
lines = [line[10:] if line.startswith('          ') else line for line in raw.splitlines()]
script = '\n'.join(lines) + '\n'
cut = script.index('# 5) Reuse the actual NPC dialogue shell/camera while explicitly skipping humanoid-only')
script = script[:cut]
script = script.replace(
    '"""    headNodOffsetDeg,\n      debugSnapshot,\n"""',
    '"""    headNodOffsetDeg,\n    debugSnapshot,\n"""',
    1,
)
script = script.replace(
    '"""    headNodOffsetDeg,\n      dialogueLinesFor,\n      debugSnapshot,\n"""',
    '"""    headNodOffsetDeg,\n    dialogueLinesFor,\n    debugSnapshot,\n"""',
    1,
)
exec(compile(script, '/tmp/livestock_profiles_patch.py', 'exec'), {})

p = Path('docs/game.js')
s = p.read_text()

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)

s = replace_once(s, 'async function openNpcDialogue(walker) {',
                 'async function openNpcDialogue(walker, options = {}) {',
                 'openNpcDialogue signature')
s = replace_once(s, "window.DialogueContent?.recordNpcMemory(rec?.id, 'talked');",
                 "if (options.recordMemory !== false) window.DialogueContent?.recordNpcMemory(rec?.id, 'talked');",
                 'dialogue memory option')
s = replace_once(s, 'activeCameraTarget = walker.root;',
                 'activeCameraTarget = options.cameraTarget || walker.root;',
                 'dialogue camera target')
s = replace_once(s, 'beginNpcDialogueStaging(walker);',
                 'if (options.skipStaging !== true) beginNpcDialogueStaging(walker);',
                 'dialogue staging option')

visible_stmt = "_npcDialogueEl.setAttribute('aria-hidden', 'false');"
if s.count(visible_stmt) != 1:
    raise SystemExit(f'dialogue visible statement count {s.count(visible_stmt)}')
s = s.replace(visible_stmt, visible_stmt + """
      // Animal-shaped speakers reuse the full NPC dialogue shell and camera, but
      // deliberately bypass NPC-only quests, favors, shops, and memory bookkeeping.
      if (options.skipNpcMeta === true) {
        window.DialogueContent?.beginNpcConversation(rec);
        return;
      }
""", 1)

helper_anchor = '// advanceNpcDialogue now lives in js/dialogue-content.js'
if s.count(helper_anchor) != 1:
    raise SystemExit(f'livestock helper anchor count {s.count(helper_anchor)}')
helper = r"""
      function createLivestockDialogueCameraTarget(animal, kind) {
        const focus = new THREE.Object3D();
        focus.name = `livestock_dialogue_head_${animal?.id || kind || 'animal'}`;
        const frame = window.AnimalChatheadFrame?.frameForKind?.(kind);
        const plane = animal?.avatarRef?.frontPlane || null;
        const modelWidth = Number(animal?.modelWidth);
        const modelHeight = Number(animal?.modelHeight);
        if (frame && plane?.localToWorld && Number.isFinite(modelWidth) && Number.isFinite(modelHeight)) {
          const centerX = frame.x + frame.width * 0.5;
          const centerY = frame.y + frame.height * 0.5;
          const localHead = new THREE.Vector3(
            (centerX - 0.5) * modelWidth,
            (0.5 - centerY) * modelHeight,
            0,
          );
          plane.updateWorldMatrix?.(true, false);
          focus.position.copy(plane.localToWorld(localHead));
        } else if (animal?.avatarRef?.group?.getWorldPosition) {
          animal.avatarRef.group.getWorldPosition(focus.position);
          focus.position.y += (Number.isFinite(modelHeight) ? modelHeight : 1) * 0.25;
        }
        scene.add(focus);
        return focus;
      }

      async function openLivestockDialogue(animal, livestockRec, dialogueLines = []) {
        if (!animal || !livestockRec || dialogueOpen) return false;
        const kind = String(livestockRec.kind || animal.animalKey || '').trim().toLowerCase();
        const focus = createLivestockDialogueCameraTarget(animal, kind);
        const walker = {
          rec: {
            id: `livestock:${livestockRec.id}`,
            name: livestockRec.name || 'Livestock',
            dialogueLines: Array.isArray(dialogueLines) && dialogueLines.length ? dialogueLines : ['...'],
          },
          profile: {
            chatheadCreatureKind: kind,
            creatureGenotype: livestockRec.genotype || animal.genotype || null,
          },
          root: animal.avatarRef?.group,
          pause: 0,
        };
        animal._dialogueFrozen = true;
        let cleaned = false;
        walker._onDialogueClose = () => {
          if (cleaned) return;
          cleaned = true;
          animal._dialogueFrozen = false;
          focus.parent?.remove(focus);
        };
        try {
          await openNpcDialogue(walker, {
            cameraTarget: focus,
            skipStaging: true,
            skipNpcMeta: true,
            recordMemory: false,
          });
          return true;
        } catch (err) {
          walker._onDialogueClose();
          console.warn('[livestock-dialogue] failed to open', err);
          return false;
        }
      }

      """
s = s.replace(helper_anchor, helper + helper_anchor, 1)

close_start = s.index('function closeNpcDialogue')
pause_at = s.index('_dialogueWalker.pause = 0;', close_start)
pause_end = pause_at + len('_dialogueWalker.pause = 0;')
s = (s[:pause_end]
     + "\n          try { _dialogueWalker._onDialogueClose?.(); }"
     + "\n          catch (err) { console.warn('[dialogue] close hook failed', err); }"
     + s[pause_end:])

init_start = s.index('window.FarmAnimals?.init({')
init_end = s.index('});', init_start)
init_block = s[init_start:init_end]
if init_block.count('showToast,') != 1:
    raise SystemExit(f'FarmAnimals showToast dependency count {init_block.count("showToast,")}')
init_block = init_block.replace('showToast,', 'showToast,\n      openLivestockDialogue,', 1)
s = s[:init_start] + init_block + s[init_end:]
p.write_text(s)

p = Path('docs/index.html')
s = p.read_text()
for pattern, repl in {
    r'js/animal-chathead-frame\.js\?v=[^"\']+': 'js/animal-chathead-frame.js?v=20260902livestock1',
    r'js/animal-vocalizations\.js\?v=[^"\']+': 'js/animal-vocalizations.js?v=20260902livestock1',
    r'js/farm-animals\.js\?v=[^"\']+': 'js/farm-animals.js?v=20260902livestock1',
    r'game\.js\?v=[^"\']+': 'game.js?v=20260902livestock1',
}.items():
    s, n = re.subn(pattern, repl, s, count=1)
    if n != 1:
        raise SystemExit(f'cache bust failed for {pattern}: {n}')
p.write_text(s)

test = r"""const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const rigWindow = {};
vm.runInNewContext(fs.readFileSync('docs/config/attachment-rig-profiles.js', 'utf8'), { window: rigWindow, console });
const frames = rigWindow.HOBUNJI_ATTACHMENT_RIG_PROFILES.creatures;
const expected = {
  grehlr: [0.12899040207823892, 0.38396704728631864, 0.24202339114154608, 0.3445860779359126],
  'gar-wolf': [0, 0.2575, 0.25, 0.3575],
  'dabinggi-hound': [0.05321196485715341, 0.2621006265961596, 0.17863723264419087, 0.350903183334192],
  drenkirra: [0.1925, 0.3575, 0.2078, 0.305],
  uumkaoii: [0.009564166583519832, 0.2923510947804583, 0.4656387672084861, 0.47038721094834346],
};
for (const [kind, values] of Object.entries(expected)) {
  const frame = frames[kind]?.chatheadFrame;
  assert(frame, `${kind} must have an authored chathead frame`);
  assert.strictEqual(frame.coordinateSpace, 'sprite-normalized-top-left');
  assert.deepStrictEqual([frame.x, frame.y, frame.width, frame.height], values, `${kind} frame must match supplied export`);
}

const farm = fs.readFileSync('docs/js/farm-animals.js', 'utf8');
const bs = farm.indexOf('function _farmAnimalGetButtons');
const be = farm.indexOf('function _farmAnimalOnAction', bs);
const buttons = farm.slice(bs, be);
const collectAt = buttons.indexOf("action: 'obj_collect_' + animal.id");
const talkAt = buttons.indexOf("action: 'obj_talk_' + animal.id");
assert(collectAt >= 0 && talkAt > collectAt, 'ready goods must be Action 1 and Talk Action 2');
assert(buttons.includes('const resourceReady ='), 'button order must explicitly depend on harvest readiness');
assert(farm.includes("if (action === 'obj_talk_' + animal.id)"), 'Talk action must route');
assert(farm.includes('deps.openLivestockDialogue?.(animal, rec, [line]);'), 'Talk must open full dialogue');
assert(farm.includes('window.AnimalVocalizations?.dialogueLinesFor?.(animal)'), 'Talk text must come from animal dialogue config');
assert(farm.includes('modelWidth: ANIMAL_W, modelHeight: ANIMAL_H'), 'rendered dimensions must be available for frame targeting');
assert(farm.includes('this._harvestFrozen || this._dialogueFrozen'), 'dialogue must freeze wandering');

const game = fs.readFileSync('docs/game.js', 'utf8');
assert(game.includes('async function openNpcDialogue(walker, options = {})'), 'NPC dialogue shell must accept restricted reuse options');
assert(game.includes('npcDialogueCameraMode()'), 'livestock must retain NPC dialogue camera mode');
assert(game.includes('activeCameraTarget = options.cameraTarget || walker.root;'), 'dialogue must accept head focus target');
assert(game.includes('if (options.skipStaging !== true) beginNpcDialogueStaging(walker);'), 'livestock must skip humanoid staging');
assert(game.includes('if (options.skipNpcMeta === true)'), 'livestock must skip NPC quest/favor/shop paths');
assert(game.includes('function createLivestockDialogueCameraTarget(animal, kind)'), 'head target helper must exist');
assert(game.includes('window.AnimalChatheadFrame?.frameForKind?.(kind)'), 'world camera target must use authored head frame');
assert(game.includes('(centerX - 0.5) * modelWidth'), 'frame center X must target world head position');
assert(game.includes('(0.5 - centerY) * modelHeight'), 'frame center Y must target world head position');
assert(game.includes('chatheadCreatureKind: kind'), 'portrait must use animal chathead renderer');
assert(game.includes('creatureGenotype: livestockRec.genotype || animal.genotype || null'), 'portrait must preserve actual livestock genotype');
assert(game.includes('_dialogueWalker._onDialogueClose?.()'), 'dialogue close must clean up livestock target/freeze');
assert(game.includes('openLivestockDialogue,'), 'FarmAnimals must receive shared dialogue opener');

const vocal = fs.readFileSync('docs/js/animal-vocalizations.js', 'utf8');
assert(vocal.includes('c?.animalKey'), 'livestock species must resolve through animalKey');
assert(vocal.includes('dialogueLinesFor'), 'animal profiles must expose ordinary dialogue lines');
const ambient = JSON.parse(fs.readFileSync('docs/config/dialogue/ambient-dialogue.json', 'utf8'));
for (const kind of Object.keys(expected)) {
  const lines = ambient.animalVocalizations?.[kind]?.dialogueLines;
  assert(Array.isArray(lines) && lines.length > 0, `${kind} needs configurable dialogue lines`);
}
console.log('livestock dialogue chathead regression: ok');
"""
Path('scripts/test-livestock-dialogue-chatheads.js').write_text(test)
