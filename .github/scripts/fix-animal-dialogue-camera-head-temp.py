from pathlib import Path
import re

game_path = Path('docs/game.js')
s = game_path.read_text()

old = """        if (!_dialogueWalker?.root) return null;
        const playerCenter = portraitAvatarCenterWorldPosition(playerMesh);
        const npcCenter = typeof _dialogueWalker.dialogueHeadWorldPosition === 'function'
          ? _dialogueWalker.dialogueHeadWorldPosition(new THREE.Vector3())
          : portraitAvatarCenterWorldPosition(_dialogueWalker.root);
        if (!playerCenter || !npcCenter) return null;
        const minDistance = modeCfg.portraitCenterMinDistanceTiles ?? 0.001;
"""
new = """        if (!_dialogueWalker?.root) return null;
        const hasAuthoredSpeakerHead = typeof _dialogueWalker.dialogueHeadWorldPosition === 'function';
        const npcCenter = hasAuthoredSpeakerHead
          ? _dialogueWalker.dialogueHeadWorldPosition(new THREE.Vector3())
          : portraitAvatarCenterWorldPosition(_dialogueWalker.root);
        if (!npcCenter) return null;

        // Animal-shaped dialogue speakers provide an authored head point rather than
        // an NPC portrait center. Treat that exact world-space pixel as the normal
        // npcDialogue camera target: same configured distance/angle/azimuth/zoom,
        // but no player->speaker pitch extrapolation (which can aim below terrain
        // when the speaker is much shorter than the player).
        if (hasAuthoredSpeakerHead) {
          return {
            cameraY: npcCenter.y + Math.sin(baseAngle) * distance,
            lookY: npcCenter.y,
            targetX: npcCenter.x,
            targetZ: npcCenter.z,
          };
        }

        const playerCenter = portraitAvatarCenterWorldPosition(playerMesh);
        if (!playerCenter) return null;
        const minDistance = modeCfg.portraitCenterMinDistanceTiles ?? 0.001;
"""
if s.count(old) != 1:
    raise SystemExit(f'expected one current dialogue camera block, found {s.count(old)}')
s = s.replace(old, new, 1)
game_path.write_text(s)

idx_path = Path('docs/index.html')
idx = idx_path.read_text()
idx, n = re.subn(r'<script src="game\.js\?v=[^"]+"></script>',
                 '<script src="game.js?v=20260902livestock5"></script>', idx, count=1)
if n != 1:
    raise SystemExit(f'expected one game.js script tag, found {n}')
idx_path.write_text(idx)

test_path = Path('scripts/test-livestock-dialogue-chatheads.js')
t = test_path.read_text()
anchor = "assert(game.includes(\"? _dialogueWalker.dialogueHeadWorldPosition(new THREE.Vector3())\"), 'NPC camera calculation must use the adapter head point directly');\n"
if anchor not in t:
    raise SystemExit('expected existing animal-camera regression anchor')
extra = anchor + "assert(game.includes(\"cameraY: npcCenter.y + Math.sin(baseAngle) * distance\"), 'animal dialogue camera must use npcDialogue angle/distance relative to the authored head point');\nassert(game.includes(\"lookY: npcCenter.y\"), 'animal dialogue camera must look directly at the authored head point instead of extrapolating below ground');\nassert(game.includes(\"targetX: npcCenter.x\"), 'animal dialogue camera X target must be the authored head point');\nassert(game.includes(\"targetZ: npcCenter.z\"), 'animal dialogue camera Z target must be the authored head point');\nassert(game.includes(\"if (hasAuthoredSpeakerHead)\"), 'animal head camera branch must be isolated from ordinary NPC portrait-center math');\n"
t = t.replace(anchor, extra, 1)
test_path.write_text(t)
