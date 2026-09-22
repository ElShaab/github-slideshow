# Hologram turntable

Renders the body hologram as a turntable — one PNG per angle, transparent,
framed identically — for `packages/mobile/scripts/prepare-hologram-frames.py`
to turn into app assets.

Blender is a Python package, so there is nothing to install by hand:

```bash
pip install bpy          # Blender 5.x, needs Python 3.11
```

## Rendering

From a sculpted anatomy mesh, which is what reaches the reference look:

```bash
python3 tools/blender/hologram_turntable.py \
  --model anatomy.glb --frames 11 --out out/lean
```

From the procedural body, which needs no asset:

```bash
python3 tools/blender/hologram_turntable.py \
  --frames 11 --adiposity 0.55 --out out/heavy
```

Then:

```bash
cd packages/mobile
python3 scripts/prepare-hologram-frames.py ../../out/lean --out assets/hologram
```

## What it does and does not do

The shader, the orbit, the framing and the alpha are the same whichever body it
renders. A hologram is bright seen edge-on and dim face-on, because that is
where the most glowing material lies along your line of sight — that is the
Fresnel term, and it does most of the work. Skin, muscle and the subcutaneous
shell are all emission mixed with transparency, so nothing is lit and you see
through all of it.

The figure turns rather than the camera. Framing then cannot drift between
frames, which is the failure that makes a turntable jitter.

**The procedural body is a stand-in.** It is a lofted surface with about
twenty-five ellipsoids placed at anatomical landmarks inside it. That reads as
a body with muscle masses under the skin, and it is nowhere near an écorché
render: a deltoid is not an ellipsoid, and no amount of parameter tuning makes
it one. The first version gave every volume a Fresnel rim and they came out
looking like bubbles in a bottle; dropping the rim and giving them a flat glow
instead fixed that, and the ceiling is still the geometry.

Reaching the reference renders means `--model` and a mesh with the muscles
actually modelled. That is an asset to buy or commission. Everything around it
is already here.

## Cost

CPU-only Cycles, no GPU needed. Roughly two minutes per frame at 900×1600 and
48 samples on four cores, so an eleven-frame turntable is about twenty minutes.
It is a one-off bake — you re-run it when the body changes, not while
iterating.
