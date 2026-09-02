from pathlib import Path

s = Path('docs/game.js').read_text()
needles = [
    'function dialoguePortraitCameraAim',
    'dialoguePortraitCameraAim()',
    'dialoguePortraitCameraAim(',
    'activeCameraTarget',
    'function npcDialogueCameraMode',
    'npcDialogueCameraMode()',
    'camera.lookAt',
    '.lookAt(',
    'cameraY',
    'lookY',
    'targetX',
]
lines = s.splitlines()
seen = set()
for needle in needles:
    print(f'\n===== {needle} =====')
    found = 0
    for i, line in enumerate(lines):
        if needle in line:
            lo = max(0, i - 18)
            hi = min(len(lines), i + 36)
            key = (lo, hi)
            if key in seen:
                continue
            seen.add(key)
            found += 1
            for j in range(lo, hi):
                print(f'{j+1:06d}: {lines[j]}')
            print('-----')
    print(f'found={found}')
