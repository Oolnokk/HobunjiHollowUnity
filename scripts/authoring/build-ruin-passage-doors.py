#!/usr/bin/env python3
"""Regenerates the Random Test Ruin passage-door furniture (docs/config/furniture-authored/).

These replace the flat brown boxes that used to close the ruin's hallway gates. They are the
Ruin Entrance Door design (carved frame, sill, open passage, sinking leaf, ONE centre seal
decal -- the Great Door without its ring of sigils) cut to the gate widths the ruin
builds. Local +Z faces the approach and the frame sits on y=0, like every other ruin door.

  ruinPassageDoor        3-wide hallway gate  (outer 3.0, clear 2.4 -- the V50 doorway size)
  ruinPassageDoorWide    5-wide gate          (outer 5.0, clear 4.28 -- native upper-floor chamber gates run 5-6 wide)
  ruinPassageDoorNarrow  2-wide gate          (outer 2.0, clear 1.5)
  ruinPassageDoorSlim    1-tile threshold     (outer 1.0, clear 0.72, thin posts and leaf)

js/dev-random-ruin-furniture-pieces.js (buildPassageGate) picks the variant nearest a gate's span.
The outer widths here must stay in step with PASSAGE_VARIANTS in that file.

Once written they can be opened and edited in docs/tools/furniture-avatar-author like any other
piece. Re-running this script overwrites hand edits, so only use it to rebuild the defaults.
"""
import json, os

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'config', 'furniture-authored')
STONE = '#7a746b'; STONE_DARK = '#5d5850'; STONE_LIGHT = '#8a847a'; LEAF = '#6f6a62'
SEAL = '../../../docs/assets/textures/decals/ruin_seal_circle.png'
SEAL_GLOW = {'off': ['#ff3b30'], 'on': ['#ffffff'], 'cycleSeconds': 1.6, 'pulse': .15}
HEIGHT = 2.4  # Overall height of a gate: the old box was 2.4 tall, and the builder scales Y from this.


def part(pid, name, kind='box', x=0, y=0, z=0, sx=1, sy=1, sz=1, color=STONE, texture='carved_smooth.png'):
    return {
        'id': pid, 'kind': kind, 'name': name,
        'transform': {'x': x, 'y': y, 'z': z, 'rx': 0, 'ry': 0, 'rz': 0, 'sx': sx, 'sy': sy, 'sz': sz},
        'color': color, 'segments': 1, 'taperAxis': 'y', 'topScaleX': 1, 'topScaleZ': 1,
        'bottomScaleX': 1, 'bottomScaleZ': 1, 'topSkewX': 0, 'topSkewZ': 0, 'innerScale': .68,
        'basinDepth': .18, 'liquidContainerId': None, 'liquidLevel': .5, 'wonkiness': 0,
        'materialRole': 'stone', 'materialTexture': texture, 'materialRotationDeg': 0,
        'materialCapTexture': None, 'materialCapRotationDeg': 0, 'materialFillEnabled': False,
        'materialFillColor': None, 'surfaceOpacity': 1, 'substanceColor': color,
        'substanceFillOpacity': 0, 'timelineUseSubstanceColor': False, 'textureDataUrl': None,
        'textureName': '', 'textureTransparent': True, 'textureTileSize': 1, 'materialLighting': 'unlit',
    }


def front_surface(p):
    t = p['transform']
    return {'id': p['id'] + ':surface:front', 'partId': p['id'], 'recognizedType': 'vertical side',
            'faceIndices': [8, 9], 'area': t['sx'] * t['sy'], 'localCentroid': [0, 0, t['sz'] / 2],
            'localNormal': [0, 0, 1], 'basisU': [1, 0, 0], 'basisV': [0, 1, 0],
            'bounds': {'minU': -t['sx'] / 2, 'maxU': t['sx'] / 2, 'minV': -t['sy'] / 2, 'maxV': t['sy'] / 2},
            'label': 'Front', 'role': 'none'}


def seal_decal(surface, diameter):
    # The decal runtime sizes a decal as a FRACTION of its face, so a round seal needs
    # width * face_width == height * face_height. Giving the diameter keeps it a circle at every gate width.
    bounds = surface['bounds']
    face_w, face_h = bounds['maxU'] - bounds['minU'], bounds['maxV'] - bounds['minV']
    return {'id': 'seal', 'name': 'Door Seal', 'surfaceId': surface['id'], 'surfacePartId': surface['partId'],
            'surfaceType': 'vertical side', 'surfaceFaces': surface['faceIndices'],
            'imageSource': SEAL, 'imageName': SEAL.replace('../../../', ''),
            'offsetU': 0, 'offsetV': .12, 'width': round(diameter / face_w, 4), 'height': round(diameter / face_h, 4), 'rotationDeg': 0,
            'normalOffset': .004, 'opacity': 1, 'visible': True, 'glow': SEAL_GLOW}


def variant(key, name, notes, outer, post, depth, leaf_depth, seal):
    clear = round(outer - post * 2, 3)
    post_h = HEIGHT - .3  # Posts stop under the lintel, which closes the top of the opening.
    leaf_h = post_h - .08  # Clear of the sill and the lintel so the leaf reads as a slab in the opening.
    leaf_y = round(leaf_h / 2 + .08, 3)
    px = round(outer / 2 - post / 2, 3)
    leaf = part('leaf', 'Door Leaf', y=leaf_y, sx=round(clear + .04, 3), sy=leaf_h, sz=leaf_depth, color=LEAF)
    face = front_surface(leaf)
    rest = {**leaf['transform']}
    parts = [
        part('post_left', 'Left Post', x=-px, y=post_h / 2, sx=post, sy=post_h, sz=depth),
        part('post_right', 'Right Post', x=px, y=post_h / 2, sx=post, sy=post_h, sz=depth),
        part('lintel', 'Lintel', y=post_h + .15, sx=outer, sy=.3, sz=round(depth + .08, 3), color=STONE_LIGHT),
        part('sill', 'Sill', y=.04, z=.06, sx=round(clear, 3), sy=.08, sz=round(depth + .16, 3), color=STONE_DARK),
        leaf,
    ]
    data = {
        'schema': 'hobunji_furniture_authored_runtime.v1', 'key': key, 'id': key, 'name': name,
        'sourceSchema': 'hobunji_furniture_surface_author.v58', 'notes': notes,
        'footprint': {'w': round(outer), 'd': 1},
        'tileBase': {'visible': True, 'tileSize': 1, 'footprintW': round(outer), 'footprintD': 1, 'y': 0, 'gridOpacity': .55},
        'parts': parts, 'recognizedSurfaces': [face], 'decals': [seal_decal(face, seal)],
        'decalAuthoring': {'version': 4},
        'puzzle': {'role': 'mechanism', 'behavior': 'stoneDoor', 'blocksMovement': True,
                   'motion': {'durationSeconds': 2.2, 'collisionOpenProgress': .8,
                              'parts': {'leaf': {'off': {**rest}, 'on': {**rest, 'y': round(-leaf_h / 2 - .1, 3)}}}}},
    }
    with open(os.path.join(ROOT, key + '.json'), 'w') as fh:
        json.dump(data, fh, indent=2)
        fh.write('\n')


variant('ruinPassageDoor', 'Ruin Passage Door',
        'Hallway gate for the Random Test Ruin: carved frame with a sinking leaf and a single centre seal. Local +Z faces the approach. The seal glows OFF (red) while the gate is shut.',
        outer=3.0, post=.3, depth=.7, leaf_depth=.24, seal=.5)
variant('ruinPassageDoorNarrow', 'Ruin Passage Door (Narrow)',
        'Two-wide variant of the ruin passage door for narrower hallway gates.',
        outer=2.0, post=.25, depth=.62, leaf_depth=.22, seal=.42)
variant('ruinPassageDoorWide', 'Ruin Passage Door (Wide)',
        'Five-wide variant of the ruin passage door for the wide native upper-floor chamber gates.',
        outer=5.0, post=.36, depth=.78, leaf_depth=.28, seal=.6)
variant('ruinPassageDoorSlim', 'Ruin Passage Door (Slim)',
        'One-tile variant of the ruin passage door: thin posts and a thin leaf so it fits a single-tile threshold without crowding the opening.',
        outer=1.0, post=.14, depth=.4, leaf_depth=.16, seal=.3)

# The Furniture Author lists pieces from index.json; keep the variants registered.
index_path = os.path.join(ROOT, 'index.json')
with open(index_path) as fh:
    index = json.load(fh)
known = {entry['key'] for entry in index['furniture']}
for key in ('ruinPassageDoor', 'ruinPassageDoorNarrow', 'ruinPassageDoorSlim', 'ruinPassageDoorWide'):
    if key not in known:
        index['furniture'].append({'key': key, 'file': 'config/furniture-authored/' + key + '.json'})
with open(index_path, 'w') as fh:
    json.dump(index, fh, indent=2)
    fh.write('\n')
