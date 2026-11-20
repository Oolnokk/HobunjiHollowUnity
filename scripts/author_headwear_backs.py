#!/usr/bin/env python3
"""Build pixel-exact dual-flipped rear headwear and an installable ZIP (no source mutation).

Usage: python scripts/author_headwear_backs.py --root . --out /tmp/headwear_behind_install.zip
Requires Pillow. All front PNGs remain unchanged. This script only creates a ZIP.
"""
from __future__ import annotations
import argparse, hashlib, io, json, re, zipfile
from pathlib import Path
from PIL import Image, ImageDraw

CONFIGS = {
 "basic_headband":"docs/config/cosmetics/basic_headband.json",
 "leather_headband":"docs/config/cosmetics/leather_headband.json",
 "five_blossom_crown":"docs/config/cosmetics/five_blossom_crown.json",
 "tangedcirclet":"docs/config/cosmetics/clothes/hat/tangedcirclet.json",
}
ASSETS = Path("docs/assets/cosmetics/clothes/hat")

def layers(cfg):
 yield "default", cfg["parts"]["head"]["layers"]["front"]
 for name, variant in cfg.get("speciesVariants",{}).items():
  front=variant.get("parts",{}).get("head",{}).get("layers",{}).get("front")
  if front: yield name,front

def filename(url):
 name=Path(url).name
 if not name.endswith(".png") or name!=name.lower(): raise ValueError("Bad sprite path: "+url)
 return name

def flipped(im):
 im=im.convert("RGBA"); box=im.getchannel("A").getbbox()
 if not box: raise ValueError("Empty sprite")
 out=Image.new("RGBA",im.size)
 out.paste(im.crop(box).transpose(Image.Transpose.ROTATE_180),box[:2])
 if out.getchannel("A").getbbox()!=box: raise AssertionError("Unexpected alpha bounds")
 if out.crop(box).transpose(Image.Transpose.ROTATE_180).tobytes()!=im.crop(box).tobytes():
  raise AssertionError("Dual-axis flip is not lossless")
 return out

def seven_nodes(im):
 a=im.getchannel("A"); box=a.getbbox()
 x0,y0,x1,y1=box; observed=[]
 for i in range(7):
  x=round(x0+(x1-x0-1)*i/6)
  ys=[y for y in range(y0,y1) if a.getpixel((x,y))>=40]
  if not ys:
   ys=[y for xx in range(x0,x1) for y in range(y0,y1)
       if abs(xx-x)<=12 and a.getpixel((xx,y))>=40]
  if not ys: raise ValueError("Could not trace seven headband/crown nodes")
  ys.sort();observed.append((x,ys[len(ys)//2]))
 destination=[(x0+x1-1-x,y0+y1-1-y) for x,y in observed[::-1]]
 assert all(destination[k][0]<destination[k+1][0] for k in range(6))
 return {"original":observed,"rear_flipped_X_and_Y":destination,"bounds":box}

def metalize(im):
 """Neutral silver-blue base; existing circlet HAT/base-A alloy tint stays in control."""
 im=im.convert("RGBA");out=Image.new("RGBA",im.size)
 src,dst=im.load(),out.load()
 for y in range(im.height):
  for x in range(im.width):
   r,g,b,a=src[x,y]
   if not a: continue
   v=round(.2126*r+.7152*g+.0722*b)
   if max(r,g,b)<44 or v<34:dst[x,y]=(r,g,b,a);continue
   p=min(235,max(77,round(124+(v-90)*1.18)))
   dst[x,y]=(round(p*.93),round(p*.98),min(255,round(p*1.06)),a)
 return out

def png_data(img):
 buf=io.BytesIO();img.save(buf,"PNG",optimize=True);return buf.getvalue()

def preview(sprites):
 items=sorted(sprites);w,h=330,256
 sheet=Image.new("RGB",(4*w,((len(items)+3)//4)*h+40),(27,33,39))
 d=ImageDraw.Draw(sheet);d.text((14,12),"REAR HEADBANDS + FIVE BLOSSOM CROWNS | both spline axes flipped",fill="white")
 for n,name in enumerate(items):
  left=(n%4)*w;top=(n//4)*h+36
  d.rectangle((left+5,top+3,left+w-6,top+h-6),fill=(50,57,63))
  cut=sprites[name].crop(sprites[name].getbbox())
  cut.thumbnail((w-18,h-49),Image.Resampling.NEAREST)
  cut=cut.resize((cut.width*2,cut.height*2),Image.Resampling.NEAREST)
  cut.thumbnail((w-18,h-49),Image.Resampling.NEAREST)
  sheet.paste(cut,(left+(w-cut.width)//2,top+12),cut)
  d.text((left+9,top+h-29),name,fill=(236,242,244))
 return sheet

def build(root,out):
 configs={name:json.loads((root/path).read_text(encoding="utf-8"))
          for name,path in CONFIGS.items()}
 names={filename(layer["image"]["url"])
        for item in ("basic_headband","leather_headband","five_blossom_crown")
        for _,layer in layers(configs[item])}
 original={};sprite={};points={}
 for name in sorted(names):
  im=Image.open(root/ASSETS/name).convert("RGBA")
  if im.size!=(234,173):raise ValueError(f"{name} is {im.size}, not 234x173")
  original[name]=im
  rear_name=name.removesuffix(".png")+"_behind.png"
  sprite[rear_name]=flipped(im);points[rear_name]=seven_nodes(im)
 for item in ("basic_headband","leather_headband","five_blossom_crown"):
  for _,layer in layers(configs[item]):
   rear=filename(layer["image"]["url"]).removesuffix(".png")+"_behind.png"
   layer["behindImage"]={"url":"./assets/cosmetics/clothes/hat/"+rear}
 # Circlets already carry dynamic metal/alloy palette A; only replace the rear silhouette.
 circlet_to_rear={}
 for _,layer in layers(configs["tangedcirclet"]):
  front=filename(layer["image"]["url"])
  if front.startswith("tl_"):band="tl_headband.png"
  elif front.startswith("kenk_"):band="kenk_headband_f.png" if front.endswith("_f.png") else "kenk_headband_m.png"
  elif front.startswith("mashtz_"):band="mashtz_headband_m.png"
  else:band="headband.png"
  metal=band.removesuffix(".png")+"_behind_metal.png"
  if metal not in sprite:
   sprite[metal]=metalize(flipped(original[band]))
   points[metal]=seven_nodes(original[band])
  layer["behindImage"]={"url":"./assets/cosmetics/clothes/hat/"+metal}
  circlet_to_rear[front]=metal
 # Explicit behindImage takes priority. Update old runtime fallback rules as well.
 js_path="docs/config/scratchbones-config.js"
 js=(root/js_path).read_text(encoding="utf-8")
 regex=r'("urlIncludes"\s*:\s*\[\s*"cosmetics/clothes/hat/(?P<circlet>[^"/]*tangedcirclet[^"/]*\.png)"\s*\]\s*,\s*"url"\s*:\s*")(?P<old>cosmetics/clothes/hat/[^"/]+\.png)(")'
 replaced=[]
 def replace(m):
  name=m.group("circlet")
  if name not in circlet_to_rear:raise ValueError("Unknown circlet fallback: "+name)
  new="cosmetics/clothes/hat/"+circlet_to_rear[name]
  replaced.append(name)
  return m.group(1)+new+m.group(4)
 js=re.sub(regex,replace,js)
 if len(replaced)<5:raise AssertionError("Not all circlet fallback rules found")
 output={str(ASSETS/name):png_data(im) for name,im in sprite.items()}
 for key,path in CONFIGS.items():
  output[path]=(json.dumps(configs[key],indent=2,ensure_ascii=False)+"\n").encode()
 output[js_path]=js.encode()
 for key,cfg in configs.items():
  for variant,layer in layers(cfg):
   assert str(ASSETS/filename(layer["behindImage"]["url"])) in output,(key,variant)
 output["SPLINE_MAPS.json"]=(json.dumps(points,indent=2)+"\n").encode()
 pic=preview(sprite)
 output["PREVIEW.png"]=png_data(pic)
 output["README.txt"]=("\n".join([
  "Installable rear headwear sprite pack. Extract this ZIP into repository root.",
  "All original front sprites remain unchanged. These sprites are dual X/Y reflections",
  "inside their occupied alpha bounding boxes (pixel-exact, no generated pixels).",
  "The game still applies its usual horizontal reversal for back-head observation.",
  "New behindImage entries are included for basic/leather headbands, Five Blossom",
  "Crown and Tanged Circlet default + species variants.",
  "Circlet rear sprites use neutral metal-shaded headband artwork; material/metal",
  "tint, palette A, dye treatment and verdigris stay controlled by the game.",
  "Legacy circlet rear replacement rules now target behind_metal PNGs too.",
  f"{len(sprite)} PNGs; {len(replaced)} circlet fallback rules; {len(configs)} cosmetic JSONs.",
  "Inspect PREVIEW.png and SPLINE_MAPS.json before installing.",
  ""])).encode()
 output["SHA256.json"]=(json.dumps({n:hashlib.sha256(blob).hexdigest()
                                  for n,blob in sorted(output.items())},indent=2)+"\n").encode()
 out.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for name,blob in sorted(output.items()):z.writestr(name,blob)
 with zipfile.ZipFile(out) as z:
  for name,blob in output.items():assert z.read(name)==blob
 # Runner can consume the printout without parsing a complicated manifest.
 print(json.dumps({"zip":str(out),"png_count":len(sprite),"changed_config_count":len(configs)+1,
                   "circlet_fallback_count":len(replaced),"png_names":sorted(sprite)}))

if __name__=="__main__":
 ap=argparse.ArgumentParser()
 ap.add_argument("--root",type=Path,default=Path("."))
 ap.add_argument("--out",type=Path,default=Path("headwear_behind_install.zip"))
 args=ap.parse_args();build(args.root.resolve(),args.out.resolve())
