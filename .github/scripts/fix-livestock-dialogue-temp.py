from pathlib import Path
import re

game_path = Path('docs/game.js')
s = game_path.read_text()

# Full triggered livestock dialogue is 3D-only. The profile made DialogueContent
# repeatedly composite/render the animal into npcPortraitCanvas. Popup/ambient
# chatheads keep using AnimalChatheadFrame independently.
profile_block = """          profile: {
            chatheadCreatureKind: kind,
            creatureGenotype: livestockRec.genotype || animal.genotype || null,
          },
"""
if s.count(profile_block) != 1:
    raise SystemExit(f'expected one livestock dialogue profile block, found {s.count(profile_block)}')
s = s.replace(profile_block, """          // Deliberately no `profile`: triggered livestock dialogue stays in 3D.
          // Authored animal crops are rendered only by popup/ambient chatheads;
          // full dialogue uses the frame center strictly as head-position metadata.
""", 1)

# Feed the animal adapter's exact authored frame-center world point into the same
# portrait-center camera calculation NPCs already use, falling back unchanged for NPCs.
old_center = """        const playerCenter = portraitAvatarCenterWorldPosition(playerMesh);
        const npcCenter = portraitAvatarCenterWorldPosition(_dialogueWalker.root);
        if (!playerCenter || !npcCenter) return null;
"""
new_center = """        const playerCenter = portraitAvatarCenterWorldPosition(playerMesh);
        const npcCenter = typeof _dialogueWalker.dialogueHeadWorldPosition === 'function'
          ? _dialogueWalker.dialogueHeadWorldPosition(new THREE.Vector3())
          : portraitAvatarCenterWorldPosition(_dialogueWalker.root);
        if (!playerCenter || !npcCenter) return null;
"""
if s.count(old_center) != 1:
    raise SystemExit(f'expected one dialogue portrait center block, found {s.count(old_center)}')
s = s.replace(old_center, new_center, 1)

# No-profile speakers should not inherit stale pixels from the previously-rendered NPC.
old_portrait = """        if (walker.profile && window.NpcAvatarPreview) {
          const ctx = _npcPortraitCanvas.getContext('2d');
          ctx.fillStyle = '#1b3529';
          ctx.fillRect(0, 0, _npcPortraitCanvas.width, _npcPortraitCanvas.height);
          await window.DialogueContent?.renderNpcDialoguePortrait();
        }
"""
new_portrait = """        if (walker.profile && window.NpcAvatarPreview) {
          const ctx = _npcPortraitCanvas.getContext('2d');
          ctx.fillStyle = '#1b3529';
          ctx.fillRect(0, 0, _npcPortraitCanvas.width, _npcPortraitCanvas.height);
          await window.DialogueContent?.renderNpcDialoguePortrait();
        } else {
          // Triggered animal dialogue has no portrait profile: keep the ordinary
          // dialogue shell but never project/recompose the livestock sprite in 2D.
          _npcPortraitCanvas?.getContext?.('2d')?.clearRect(0, 0, _npcPortraitCanvas.width, _npcPortraitCanvas.height);
        }
"""
if s.count(old_portrait) != 1:
    raise SystemExit(f'expected one openNpcDialogue portrait block, found {s.count(old_portrait)}')
s = s.replace(old_portrait, new_portrait, 1)

# Guard the requested architecture.
adapter_start = s.index('      function createLivestockNpcDialogueAdapter')
adapter_end = s.index('      async function openLivestockDialogue', adapter_start)
adapter = s[adapter_start:adapter_end]
if 'chatheadCreatureKind' in adapter or 'creatureGenotype:' in adapter or 'profile:' in adapter:
    raise SystemExit('triggered livestock adapter still exposes a portrait profile')
if "frame.x + frame.width * 0.5" not in s or "frame.y + frame.height * 0.5" not in s:
    raise SystemExit('livestock head point is not the exact frame center')
if "typeof _dialogueWalker.dialogueHeadWorldPosition === 'function'" not in s:
    raise SystemExit('NPC camera math is not consuming adapter head point')
game_path.write_text(s)

# Cache-bust only game.js.
idx_path = Path('docs/index.html')
idx = idx_path.read_text()
idx, n = re.subn(r'<script src="game\.js\?v=[^"]+"></script>',
                 '<script src="game.js?v=20260902livestock4"></script>',
                 idx, count=1)
if n != 1:
    raise SystemExit(f'expected one game.js script tag, found {n}')
idx_path.write_text(idx)

# Update the focused regression to assert the 3D-only/full-dialogue split and the
# exact reuse of the existing NPC portrait-center camera calculation.
test_path = Path('scripts/test-livestock-dialogue-chatheads.js')
t = test_path.read_text()
old_asserts = """assert(game.includes('chatheadCreatureKind: kind'), 'portrait must use animal chathead renderer');
assert(game.includes('creatureGenotype: livestockRec.genotype || animal.genotype || null'), 'portrait must preserve actual livestock genotype');
"""
new_asserts = """assert(!adapter.includes('profile:'), 'triggered livestock dialogue must not expose a portrait profile');
assert(!adapter.includes('chatheadCreatureKind'), 'triggered livestock dialogue must not render a popup-chathead crop into the full dialogue UI');
assert(!adapter.includes('creatureGenotype:'), 'triggered livestock dialogue must not repeatedly composite a genotype portrait');
assert(game.includes("typeof _dialogueWalker.dialogueHeadWorldPosition === 'function'"), 'NPC camera calculation must accept the animal head point');
assert(game.includes("? _dialogueWalker.dialogueHeadWorldPosition(new THREE.Vector3())"), 'NPC camera calculation must use the adapter head point directly');
assert(game.includes(": portraitAvatarCenterWorldPosition(_dialogueWalker.root);"), 'ordinary NPCs must keep their existing portrait-center fallback');
assert(game.includes('frame.x + frame.width * 0.5'), 'triggered dialogue head X must be the exact center pixel of the authored frame');
assert(game.includes('frame.y + frame.height * 0.5'), 'triggered dialogue head Y must be the exact center pixel of the authored frame');
assert(game.includes("clearRect(0, 0, _npcPortraitCanvas.width, _npcPortraitCanvas.height)"), 'no-profile dialogue must clear any stale NPC portrait without rendering a livestock sprite');
"""
if t.count(old_asserts) != 1:
    raise SystemExit(f'expected old portrait assertions once, found {t.count(old_asserts)}')
t = t.replace(old_asserts, new_asserts, 1)
test_path.write_text(t)
