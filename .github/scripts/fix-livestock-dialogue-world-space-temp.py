from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


game_path = Path('docs/game.js')
s = game_path.read_text()

# Shared dialogue actors are not guaranteed to be direct children of the scene.
# Resolve their root through Three.js world matrices before NPC staging/facing math.
helper_anchor = '      function beginNpcDialogueStaging(walker) {'
helper = '''      const _dialogueWalkerWorldScratch = new THREE.Vector3();
      function dialogueWalkerWorldPosition(walker, out = new THREE.Vector3()) {
        const root = walker?.root;
        if (!root) return null;
        if (typeof root.getWorldPosition === 'function') {
          root.updateWorldMatrix?.(true, false);
          return root.getWorldPosition(out);
        }
        const pos = root.position;
        if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) return null;
        return out.set(pos.x, pos.y, pos.z);
      }

'''
if 'function dialogueWalkerWorldPosition(' not in s:
    if helper_anchor not in s:
        raise SystemExit('dialogue world-position helper anchor missing')
    s = s.replace(helper_anchor, helper + helper_anchor, 1)

old_staging = '''        const npcX = walker?.root?.position?.x;
        const npcZ = walker?.root?.position?.z;
        if (!Number.isFinite(npcX) || !Number.isFinite(npcZ)) { npcDialogueStaging = null; return; }
'''
new_staging = '''        const npcWorld = dialogueWalkerWorldPosition(walker, new THREE.Vector3());
        if (!npcWorld) { npcDialogueStaging = null; return; }
        const npcX = npcWorld.x;
        const npcZ = npcWorld.z;
'''
s = replace_once(s, old_staging, new_staging, 'dialogue staging world position')

face_start = s.index('      function faceNpcDialogueParticipants(dt = 1 / 60) {')
face_end = s.index('      function updateNpcDialogueStaging(dt)', face_start)
face = s[face_start:face_end]

pair_pattern = re.compile(
    r'(?P<indent>\s*)const npcX = walker\.root\.position\.x;\n(?P=indent)const npcZ = walker\.root\.position\.z;'
)
face, pair_count = pair_pattern.subn(
    lambda m: (
        f"{m.group('indent')}const npcWorld = dialogueWalkerWorldPosition(walker, _dialogueWalkerWorldScratch);\n"
        f"{m.group('indent')}if (!npcWorld) return;\n"
        f"{m.group('indent')}const npcX = npcWorld.x;\n"
        f"{m.group('indent')}const npcZ = npcWorld.z;"
    ),
    face,
    count=1,
)
if pair_count != 1:
    raise SystemExit(f'dialogue facing world position: expected one x/z pair, found {pair_count}')

local_eye_count = face.count('walker.root.position, walker.avatarHeight')
if local_eye_count != 2:
    raise SystemExit(f'dialogue eye-contact local root uses: expected 2, found {local_eye_count}')
face = face.replace('walker.root.position, walker.avatarHeight', 'npcWorld, walker.avatarHeight')
s = s[:face_start] + face + s[face_end:]

# The regular camera smooth-follow path reads activeCameraTarget.position every frame.
# Give it the same live authored head world point used by dialoguePortraitCameraAim,
# instead of a potentially-parent-relative livestock root position.
adapter_anchor = '        const headScratch = new THREE.Vector3();\n'
adapter_extra = '''        const cameraHeadScratch = new THREE.Vector3();
        const dialogueCameraTarget = {
          get position() {
            return _livestockDialogueHeadWorldPosition(animal, kind, cameraHeadScratch);
          },
        };
'''
adapter_start = s.index('      function createLivestockNpcDialogueAdapter(')
adapter_end = s.index('      async function openLivestockDialogue(', adapter_start)
adapter = s[adapter_start:adapter_end]
if 'const dialogueCameraTarget =' not in adapter:
    adapter = replace_once(adapter, adapter_anchor, adapter_anchor + adapter_extra, 'livestock dialogue camera target')
    adapter = replace_once(adapter, '          pause: 0,\n', '          pause: 0,\n          dialogueCameraTarget,\n', 'livestock adapter camera target field')
s = s[:adapter_start] + adapter + s[adapter_end:]

livestock_start = s.index('      async function openLivestockDialogue(')
livestock_end = s.index('      // advanceNpcDialogue now lives', livestock_start)
livestock = s[livestock_start:livestock_end]
if 'cameraTarget: walker.dialogueCameraTarget,' not in livestock:
    livestock = replace_once(
        livestock,
        '''          await openNpcDialogue(walker, {
            skipNpcMeta: true,
''',
        '''          await openNpcDialogue(walker, {
            cameraTarget: walker.dialogueCameraTarget,
            skipNpcMeta: true,
''',
        'livestock open shared camera target',
    )
s = s[:livestock_start] + livestock + s[livestock_end:]

game_path.write_text(s)

# Cache-bust only the changed monolithic game entry point.
index_path = Path('docs/index.html')
idx = index_path.read_text()
idx, n = re.subn(
    r'<script src="game\.js\?v=[^"]+"></script>',
    '<script src="game.js?v=20260902livestock6"></script>',
    idx,
    count=1,
)
if n != 1:
    raise SystemExit(f'game.js cache tag: expected one match, found {n}')
index_path.write_text(idx)

# Strengthen the permanent regression around the actual coordinate-space bug.
test_path = Path('scripts/test-livestock-dialogue-chatheads.js')
t = test_path.read_text()
t = replace_once(
    t,
    "assert(!livestockDialogue.includes('cameraTarget:'), 'livestock must use the ordinary NPC camera target/zoom path');",
    "assert(livestockDialogue.includes('cameraTarget: walker.dialogueCameraTarget'), 'shared camera follow must track the livestock authored head in world space');",
    'livestock camera-target regression',
)

anchor = "assert(game.includes('function createLivestockNpcDialogueAdapter(animal, livestockRec, kind, dialogueLines = [])'), 'livestock must adapt to the NPC walker contract');\n"
extra = anchor + (
    "assert(game.includes('function dialogueWalkerWorldPosition(walker, out = new THREE.Vector3())'), 'shared dialogue staging/facing needs an explicit world-position resolver');\n"
    "assert(game.includes(\"typeof root.getWorldPosition === 'function'\"), 'dialogue root resolver must use Three.js world matrices when available');\n"
    "assert(game.includes('const npcWorld = dialogueWalkerWorldPosition(walker, new THREE.Vector3())'), 'dialogue auto-approach staging must use the speaker world position');\n"
)
t = replace_once(t, anchor, extra, 'world-position helper test anchor')

adapter_assert_anchor = "assert(adapter.includes('dialogueHeadWorldPosition(out = new THREE.Vector3())'), 'animal adapter must expose authored head world position');\n"
adapter_assert_extra = adapter_assert_anchor + (
    "assert(adapter.includes('const dialogueCameraTarget = {'), 'animal adapter must expose a live shared-camera target');\n"
    "assert(adapter.includes('get position()'), 'animal camera target must resolve live each frame rather than snapshotting the head');\n"
    "assert(adapter.includes('_livestockDialogueHeadWorldPosition(animal, kind, cameraHeadScratch)'), 'animal camera target must use the authored head world point');\n"
)
t = replace_once(t, adapter_assert_anchor, adapter_assert_extra, 'adapter camera-target test anchor')

face_assert_anchor = "assert(game.includes('walker.applyFacingDeadzone(npcTargetRot'), 'shared NPC body-facing call must remain authoritative');\n"
face_assert_extra = face_assert_anchor + (
    "assert(game.includes('const npcWorld = dialogueWalkerWorldPosition(walker, _dialogueWalkerWorldScratch)'), 'continuous dialogue facing must use the speaker world position');\n"
    "assert(!game.slice(game.indexOf('function faceNpcDialogueParticipants'), game.indexOf('function updateNpcDialogueStaging')).includes('walker.root.position, walker.avatarHeight'), 'continuous dialogue eye-contact must not feed parent-relative root coordinates into world-space aiming');\n"
)
t = replace_once(t, face_assert_anchor, face_assert_extra, 'dialogue facing regression anchor')

test_path.write_text(t)
