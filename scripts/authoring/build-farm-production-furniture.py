"""Build editable, textured farm production structures in the furniture part schema."""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'docs/config/furniture-authored'
FAMILIES = ['waterSilo', 'compostBin', 'windmill', 'fodderMill', 'smokehouse', 'jerkyDryer']

def build(family, tier, index):
    width = 2 + index  # Tier footprint and decorative scale.
    height = 1.6 + index * .3  # Main structure height; tower/mill tops extend above it.
    parts = []  # Editable primitive/GLB pieces exported to the furniture editor.
    animations = []  # Existing rigid-piece animation schema, shared by runtime and editor.
    def piece(name, kind, x, y, z, sx, sy, sz, role='wood', color=None, rx=0, ry=0, rz=0, **extras):
        record = dict(id=name.replace(' ', '-').lower(), name=name, kind=kind,
                      transform=dict(x=x,y=y,z=z,sx=sx,sy=sy,sz=sz,rx=rx,ry=ry,rz=rz),
                      materialRole=role, materialTexture='carved_smooth.png',
                      color=color or ('#7d7355' if role=='wood' else '#4d4d4d'), segments=16,
                      topScaleX=1, topScaleZ=1, bottomScaleX=1, bottomScaleZ=1)
        record.update(extras)
        parts.append(record)
        return record['id']
    piece('Stone plinth', 'box',0,.12,0,width*.96,.24,width*.96,'stone')
    if family == 'waterSilo':
        radius = width * .68  # Broad collecting vessel on stone legs.
        for i,(x,z) in enumerate([(-.5,-.5),(.5,-.5),(-.5,.5),(.5,.5)]):
            piece(f'Stone leg {i}', 'box',x*width*.65,.45,z*width*.65,.2,.7,.2,'stone')
        piece('Rainwater collecting tank','cup',0,height*.8,0,radius,height,radius,'wood',innerScale=.82,basinDepth=.35)
        for i in range(3): piece(f'Tank hoop {i}','hoop',0,height*.4+i*height*.38,0,radius*1.04,.08,radius*1.04,'stone',innerScale=.93)
        piece('Rain funnel','cup',0,height*1.3,0,radius*1.15,.24,radius*1.15,'wood',innerScale=.9,basinDepth=.2)
        piece('Outlet pipe','cylinder',0,.35,-width*.46,.12,width*.32,.12,'stone',rx=90)
        piece('Outlet valve','disc',0,.43,-width*.36,.22,.06,.22,'wood',rx=90)
    elif family == 'compostBin':
        piece('Compost bed','box',0,.36,0,width*.76,.22,width*.76,'earth','#4c372b')
        for x in [-1,1]:
            for z in [-1,1]: piece(f'Corner post {x} {z}','box',x*width*.4,.75,z*width*.4,.16,1.25,.16)
        for i in range(5):
            for x in [-1,1]: piece(f'Side slat {i} {x}','box',x*width*.4,.3+i*.2,0,.09,.14,width*.8)
            for z in [-1,1]: piece(f'Front slat {i} {z}','box',0,.3+i*.2,z*width*.4,width*.8,.14,.09)
        piece('Sloped cover','box',0,1.35,0,width*.87,.12,width*.87,rx=-8)
        piece('Cover grip','box',0,1.49,-width*.12,.32,.08,.1)
    else:
        is_mill = family in ['windmill','fodderMill']  # Mills have a tapered tower and four animated highland shingle blades.
        tower = height * (1.7 if is_mill else 1)  # Keeps the rotor clear of farm ground and doorways.
        piece('Stone body','box',0,tower*.5,0,width*.76,tower,width*.76,'stone',topScaleX=.78 if is_mill else 1,topScaleZ=.78 if is_mill else 1)
        for x in [-1,1]:
            for z in [-1,1]: piece(f'Corner timber {x} {z}','box',x*width*.36,tower*.48,z*width*.36,.14,tower*.92,.14)
        piece('Dark doorway','box',0,.65,-width*.39,.56,1.03,.035,'dark','#29251f')
        for x in [-1,1]: piece(f'Door jamb {x}','box',x*.32,.7,-width*.405,.1,1.2,.14)
        piece('Door lintel','box',0,1.3,-width*.405,.75,.12,.14)
        piece('Door step','box',0,.19,-width*.45,.84,.1,.34,'stone')
        for side in [-1,1]:
            piece(f'Roof slope {side}','box',side*width*.22,tower+.2,0,width*.6,.14,width*.88,rz=side*27)
            for i in range(7):
                piece(f'Roof rib {side} {i}','box',side*width*.22,tower+.285,-width*.39+i*width*.13,width*.61,.075,.035,rz=side*27)
        if is_mill:
            rotor_y = tower*.86  # Hub/frame stays fixed while each blade rotates around the same pivot.
            rotor_z = -width*.49
            piece('Rotor axle','cylinder',0,rotor_y,rotor_z,.2,.4,.2,'wood',rx=90)
            import math
            for i in range(4):
                angle = i * math.pi / 2  # Four independently editable shingle arms.
                arm = width*.63
                radius = arm*.5 + .12
                ident = piece(f'Highland shingle blade {i}','glb',math.cos(angle)*radius,rotor_y+math.sin(angle)*radius,rotor_z-.12,arm,.27,.12,'wood',rz=i*90,
                              modelPath='assets/models/HighlandLongshingle_boned.glb',hideBone=True)
                animations.append(dict(id=f'rotor-{i}',name=f'Windmill blade {i+1}',type='spin',enabled=True,
                                       drivenPartId=ident,anchorPartId=None,pivot=dict(x=0,y=rotor_y,z=rotor_z-.12),axis=dict(x=0,y=0,z=1),speed=.45,windResponse=.3,connectors=[]))
            piece('Millstone','disc',0,.5,width*.21,width*.42,.15,width*.42,'stone')
            piece('Grain hopper','cup',width*.23,.76,width*.3,.44,.48,.44,'wood',innerScale=.75,basinDepth=.3)
        else:
            if family != 'jerkyDryer':
                piece('Stone chimney','box',width*.24,tower+.58,width*.12,.36,.85,.36,'stone')
                piece('Chimney cap','box',width*.24,tower+1.03,width*.12,.46,.14,.46,'stone')
            for i in range(4):
                piece(f'Vent slat {i}','box',width*.388,.68+i*.13,0,.04,.05,width*.46)
            piece('Drying rail','box',0,1.23,0,width*.53,.08,.08)
            for i in range(3):
                piece(f'Preservation rack {i}','box',0,.45+i*.26,width*.29,width*.56,.055,.27)
    key = family + tier.capitalize()  # Matches the canonical plan and authored-file identity.
    return dict(schema='hobunji_furniture_authored_runtime.v1',key=key,sourceSchema='hobunji_farm_production.v1',
                footprint=dict(w=width,d=width),parts=parts,pieceAnimations=animations,
                particleEmitters=[],processingWarps=[],processTimelines=[],stompAttachPoints=[])

if __name__ == '__main__':
    for family in FAMILIES:
        for index,tier in enumerate(['small','medium','large']):
            data=build(family,tier,index)
            (OUTPUT / (data['key']+'.json')).write_text(json.dumps(data,indent=2)+'\n')
