from pathlib import Path

s = Path('docs/game.js').read_text()
needles = [
    'function _livestockDialogueHeadWorldPosition',
    'function portraitAvatarCenterWorldPosition',
    'function dialoguePortraitCameraAim',
    'function occlusionSafeCameraPosition',
    'function updateCameraPosition',
    'const targetPosition = activeCameraTarget?.position',
    'const portraitAim = dialoguePortraitCameraAim',
]
lines = s.splitlines()
seen = set()
for needle in needles:
    print(f'\n===== {needle} =====')
    found = 0
    for i, line in enumerate(lines):
        if needle in line:
            lo = max(0, i - 30)
            hi = min(len(lines), i + 90)
            key = (lo, hi)
            if key in seen:
                continue
            seen.add(key)
            found += 1
            for j in range(lo, hi):
                print(f'{j+1:06d}: {lines[j]}')
            print('-----')
    print(f'found={found}')
