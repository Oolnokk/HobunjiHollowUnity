#!/usr/bin/env python3
"""Regenerates the ruin-site authored furniture JSON (docs/config/furniture-authored/).

These are ordinary Furniture + Avatar Author records: once written they can be
opened, edited and re-exported from docs/tools/furniture-avatar-author like any
other piece. Re-running this script overwrites hand edits, so only use it to
rebuild the defaults.
"""
import json, math, os, random

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'config', 'furniture-authored')
STONE = '#7a746b'; STONE_DARK = '#5d5850'; STONE_LIGHT = '#8a847a'
RUNE = '../../../docs/assets/textures/decals/ruin_glyph_rune.png'
SEAL = '../../../docs/assets/textures/decals/ruin_seal_circle.png'


def part(pid, name, kind='box', x=0, y=0, z=0, sx=1, sy=1, sz=1, rx=0, ry=0, rz=0, color=STONE, texture='carved_smooth.png', opacity=1, **extra):
    record = {
        'id': pid, 'kind': kind, 'name': name,
        'transform': {'x': x, 'y': y, 'z': z, 'rx': rx, 'ry': ry, 'rz': rz, 'sx': sx, 'sy': sy, 'sz': sz},
        'color': color, 'segments': 1, 'taperAxis': 'y', 'topScaleX': 1, 'topScaleZ': 1,
        'bottomScaleX': 1, 'bottomScaleZ': 1, 'topSkewX': 0, 'topSkewZ': 0, 'innerScale': .68,
        'basinDepth': .18, 'liquidContainerId': None, 'liquidLevel': .5, 'wonkiness': 0,
        'materialRole': 'stone', 'materialTexture': texture, 'materialRotationDeg': 0,
        'materialCapTexture': None, 'materialCapRotationDeg': 0, 'materialFillEnabled': False,
        'materialFillColor': None, 'surfaceOpacity': opacity, 'substanceColor': color,
        'substanceFillOpacity': 0, 'timelineUseSubstanceColor': False, 'textureDataUrl': None,
        'textureName': '', 'textureTransparent': True, 'textureTileSize': 1, 'materialLighting': 'unlit',
    }
    record.update(extra)
    return record


def front_surface(p, label='Front'):
    t = p['transform']
    return {'id': f"{p['id']}:surface:front", 'partId': p['id'], 'recognizedType': 'vertical side', 'faceIndices': [8, 9],
            'area': t['sx'] * t['sy'], 'localCentroid': [0, 0, t['sz'] / 2], 'localNormal': [0, 0, 1],
            'basisU': [1, 0, 0], 'basisV': [0, 1, 0],
            'bounds': {'minU': -t['sx'] / 2, 'maxU': t['sx'] / 2, 'minV': -t['sy'] / 2, 'maxV': t['sy'] / 2},
            'label': label, 'role': 'none'}


def decal(did, name, surface, image, u=0, v=0, w=.5, h=.5, glow=None):
    record = {'id': did, 'name': name, 'surfaceId': surface['id'], 'surfacePartId': surface['partId'],
              'surfaceType': 'vertical side', 'surfaceFaces': surface['faceIndices'],
              'imageSource': image, 'imageName': image.replace('../../../', ''),
              'offsetU': u, 'offsetV': v, 'width': w, 'height': h, 'rotationDeg': 0,
              'normalOffset': .004, 'opacity': 1, 'visible': True}
    if glow: record['glow'] = glow
    return record


def piece(key, name, notes, parts, surfaces=(), decals=(), puzzle=None, w=1, d=1):
    data = {'schema': 'hobunji_furniture_authored_runtime.v1', 'key': key, 'id': key, 'name': name,
            'sourceSchema': 'hobunji_furniture_surface_author.v58', 'notes': notes,
            'footprint': {'w': w, 'd': d},
            'tileBase': {'visible': True, 'tileSize': 1, 'footprintW': w, 'footprintD': d, 'y': 0, 'gridOpacity': .55},
            'parts': parts, 'recognizedSurfaces': list(surfaces), 'decals': list(decals), 'decalAuthoring': {'version': 4}}
    if puzzle: data['puzzle'] = puzzle
    with open(os.path.join(ROOT, key + '.json'), 'w') as fh:
        json.dump(data, fh, indent=2)
        fh.write('\n')
    return data


SEAL_GLOW = {'off': ['#ff3b30'], 'on': ['#ffffff'], 'cycleSeconds': 1.6, 'pulse': .15}
TARGET_GLOW = {'off': ['#ff8a2a'], 'on': ['#4dff6e'], 'cycleSeconds': 2, 'pulse': .3}

# ── Entrance door: frame + sinking leaf with a single seal circle ────────────
LEAF_REST = {'x': 0, 'y': 1.15, 'z': 0, 'rx': 0, 'ry': 0, 'rz': 0, 'sx': 1.7, 'sy': 2.3, 'sz': .24}  # Motion parts need the full rest transform or the puzzle lerp rescales the leaf.
leaf = part('leaf', 'Door Leaf', x=0, y=1.15, z=0, sx=1.7, sy=2.3, sz=.24, color='#6f6a62')
leaf_face = front_surface(leaf)
piece('ruinEntranceDoor', 'Ruin Entrance Door',
      'Cliff ruin entrance. Local +Z faces the approach. The seal glows OFF (red) until every target pillar at the site is struck, then ON (white) and the leaf sinks. Opening it lets the player descend into a freshly generated ruin.',
      [part('post_left', 'Left Post', x=-1.02, y=1.35, z=0, sx=.34, sy=2.7, sz=.7),
       part('post_right', 'Right Post', x=1.02, y=1.35, z=0, sx=.34, sy=2.7, sz=.7),
       part('lintel', 'Lintel', x=0, y=2.86, z=0, sx=2.5, sy=.42, sz=.78, color=STONE_LIGHT),
       part('sill', 'Sill', x=0, y=.04, z=.08, sx=2.2, sy=.08, sz=.9, color=STONE_DARK),
       part('recess', 'Dark Passage', x=0, y=1.25, z=-.55, sx=1.72, sy=2.5, sz=.8, color='#040506', texture=None),
       leaf],
      [leaf_face],
      [decal('seal', 'Door Seal', leaf_face, SEAL, 0, .18, .34, .26, SEAL_GLOW)],
      {'role': 'mechanism', 'behavior': 'stoneDoor', 'blocksMovement': True,
       'motion': {'durationSeconds': 2.2, 'collisionOpenProgress': .8,
                  'parts': {'leaf': {'off': {**LEAF_REST, 'y': 1.15}, 'on': {**LEAF_REST, 'y': -1.2}}}}},
      w=3, d=1)

# ── Rubble door: the spent entrance, collapsed and non-functional ───────────
piece('ruinEntranceDoorRubble', 'Collapsed Ruin Door',
      'Spent ruin entrance: the frame is cracked, the lintel has dropped and the passage is choked with rubble. Purely decorative.',
      [part('post_left', 'Cracked Left Post', x=-1.02, y=1.1, z=0, sx=.34, sy=2.2, sz=.7, rz=4),
       part('post_right', 'Broken Right Post', x=1.02, y=.75, z=0, sx=.34, sy=1.5, sz=.7, rz=-6),
       part('lintel', 'Fallen Lintel', x=.25, y=1.62, z=.18, sx=2.4, sy=.42, sz=.74, rz=-17, color=STONE_LIGHT),
       part('recess', 'Blocked Passage', x=0, y=1.1, z=-.55, sx=1.72, sy=2.2, sz=.8, color='#1a1917', texture=None),
       part('rubble_a', 'Rubble', x=-.35, y=.34, z=.12, sx=.8, sy=.7, sz=.7, rx=12, ry=20, rz=9, color=STONE_DARK),
       part('rubble_b', 'Rubble', x=.42, y=.3, z=.28, sx=.7, sy=.6, sz=.62, rx=-8, ry=-30, rz=14),
       part('rubble_c', 'Rubble', x=.05, y=.86, z=.02, sx=.62, sy=.5, sz=.56, rx=20, ry=45, rz=-10, color=STONE_LIGHT),
       part('rubble_d', 'Rubble', x=-.75, y=.18, z=.55, sx=.42, sy=.36, sz=.4, ry=15),
       part('rubble_e', 'Rubble', x=.85, y=.16, z=.62, sx=.38, sy=.32, sz=.36, ry=-40, color=STONE_DARK),
       part('leaf_shard', 'Door Shard', x=-.1, y=.55, z=.62, sx=1.1, sy=.16, sz=.9, rx=-24, ry=10, color='#6f6a62')],
      w=3, d=1)

# ── Tunnel: walls + roof that sink ≥1 tile back into the host cliff ─────────
TUNNEL_DEPTH = 4.2  # From 0.8 in front of the door line back 3.4 into the cliff.
tz = -(TUNNEL_DEPTH / 2) + .8
piece('ruinEntranceTunnel', 'Ruin Entrance Tunnel',
      'Short stone tunnel housing the entrance door. Local +Z faces out of the cliff; the walls and roof run 3.4 back from the door line so the doorway reads as cut into the rock even where the cliff slope is shallow.',
      [part('wall_left', 'Left Wall', x=-1.55, y=1.55, z=tz, sx=.72, sy=3.1, sz=TUNNEL_DEPTH),
       part('wall_right', 'Right Wall', x=1.55, y=1.55, z=tz, sx=.72, sy=3.1, sz=TUNNEL_DEPTH),
       part('roof', 'Roof Slab', x=0, y=3.32, z=tz, sx=3.84, sy=.5, sz=TUNNEL_DEPTH, color=STONE_DARK),
       part('brow', 'Carved Brow', x=0, y=3.1, z=.84, sx=3.9, sy=.36, sz=.2, color=STONE_LIGHT),
       part('floor', 'Worn Floor', x=0, y=.02, z=tz, sx=2.4, sy=.04, sz=TUNNEL_DEPTH, color=STONE_DARK)],
      w=4, d=4)

# ── Target pillar: activator with a glowing glyph facing the clearing ───────
shaft = part('shaft', 'Shaft', x=0, y=1.3, z=0, sx=.62, sy=2.1, sz=.62)
shaft_face = front_surface(shaft)
piece('ruinTargetPillar', 'Ruin Target Pillar',
      'Projectile activator. The glyph on the front face glows OFF (orange) until struck, then ON (green). Every target pillar at a ruin site must be struck to open its entrance door.',
      [part('base', 'Base', x=0, y=.14, z=0, sx=.86, sy=.28, sz=.86, color=STONE_DARK),
       shaft,
       part('cap', 'Cap', x=0, y=2.46, z=0, sx=.84, sy=.22, sz=.84, color=STONE_LIGHT)],
      [shaft_face],
      [decal('glyph', 'Target Glyph', shaft_face, RUNE, 0, .3, .82, .24, TARGET_GLOW)],
      {'role': 'activator', 'behavior': 'projectile', 'prompt': 'Glyph target'})

# ── Debris-ified pillars and rubble ──────────────────────────────────────────
piece('ruinPillarBroken', 'Broken Ruin Pillar',
      'Debris-ified pillar: a snapped shaft on its base with the fallen top lying beside it.',
      [part('base', 'Base', x=0, y=.14, z=0, sx=.86, sy=.28, sz=.86, color=STONE_DARK),
       part('stump', 'Snapped Shaft', x=0, y=.72, z=0, sx=.62, sy=.95, sz=.62, rz=3, topScaleX=.86, topSkewX=.06),
       part('fallen', 'Fallen Shaft', x=.95, y=.3, z=.35, sx=.58, sy=1.2, sz=.58, rz=84, ry=25),
       part('cap', 'Fallen Cap', x=-.6, y=.13, z=.7, sx=.8, sy=.22, sz=.8, rx=9, ry=33, color=STONE_LIGHT),
       part('chip', 'Chip', x=.35, y=.1, z=-.55, sx=.26, sy=.2, sz=.24, ry=40, color=STONE_DARK)])

piece('ruinPillarStump', 'Ruin Pillar Stump',
      'Debris-ified pillar: only the base and a jagged stub remain.',
      [part('base', 'Base', x=0, y=.14, z=0, sx=.86, sy=.28, sz=.86, color=STONE_DARK),
       part('stub', 'Jagged Stub', x=.03, y=.45, z=0, sx=.62, sy=.42, sz=.62, rx=-5, rz=6, topScaleX=.7, topScaleZ=.8),
       part('chip_a', 'Chip', x=-.62, y=.1, z=.3, sx=.3, sy=.2, sz=.26, ry=20),
       part('chip_b', 'Chip', x=.5, y=.09, z=.55, sx=.24, sy=.18, sz=.22, ry=-35, color=STONE_LIGHT)])

rng = random.Random(7)
rubble = []
for i in range(7):
    a = i / 7 * math.tau + rng.uniform(-.3, .3); r = rng.uniform(.05, .6); s = rng.uniform(.25, .6)
    rubble.append(part(f'block_{i}', 'Rubble Block', x=round(math.cos(a) * r, 3), y=round(s * .42, 3), z=round(math.sin(a) * r, 3),
                       sx=round(s, 3), sy=round(s * .8, 3), sz=round(s * .9, 3), rx=rng.randint(-18, 18), ry=rng.randint(0, 90), rz=rng.randint(-18, 18),
                       color=[STONE, STONE_DARK, STONE_LIGHT][i % 3]))
piece('ruinRubblePile', 'Ruin Rubble Pile', 'Loose heap of fallen masonry.', rubble)

# ── Buried-treasure ruin hole: dark shaft with a ladder poking out ──────────
piece('ruinBurrowHole', 'Ruin Burrow Hole',
      'Opened when a buried treasure turns out to be a way into a ruin. The shaft stays until that ruin is cleared or the next Tothal Shift, then fills in.',
      [part('shaft', 'Dark Shaft', kind='cylinder', x=0, y=-.02, z=0, sx=.86, sy=.06, sz=.86, color='#050505', texture=None),
       part('rim', 'Broken Rim', kind='hoop', x=0, y=.02, z=0, sx=1.02, sy=.08, sz=1.02, color=STONE_DARK),
       part('rail_left', 'Ladder Rail', x=-.2, y=.35, z=-.18, sx=.06, sy=1.1, sz=.06, rx=-14, color='#7a5a3a', texture=None, materialRole='wood'),
       part('rail_right', 'Ladder Rail', x=.2, y=.35, z=-.18, sx=.06, sy=1.1, sz=.06, rx=-14, color='#7a5a3a', texture=None, materialRole='wood'),
       part('rung_a', 'Ladder Rung', x=0, y=.55, z=-.13, sx=.44, sy=.05, sz=.05, color='#8c6a45', texture=None, materialRole='wood'),
       part('rung_b', 'Ladder Rung', x=0, y=.25, z=-.2, sx=.44, sy=.05, sz=.05, color='#8c6a45', texture=None, materialRole='wood')])
print('wrote ruin-site furniture')
