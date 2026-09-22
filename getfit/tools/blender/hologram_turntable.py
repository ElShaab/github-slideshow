"""
Renders the hologram turntable.

    python3 tools/blender/hologram_turntable.py --frames 11 --band 20 --out out/

Produces one PNG per angle, transparent, framed identically, ready for
`packages/mobile/scripts/prepare-hologram-frames.py`.

The look is three materials over one idea: a hologram is bright where you see
it edge-on and dim where it faces you, because that is where the most glowing
material lies along your line of sight. Skin, muscle and the fat shell are all
emission driven by a Fresnel term and mixed with a Transparent BSDF — nothing
is lit, everything glows, and you see through all of it. That is why the
muscles read through the skin without any of it being cut away.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

from hologram_body import HEIGHT, Build, build_fat_shell, build_muscles, build_skin

# Sampled from the reference renders: the body is cyan-blue at hue ~205, the
# subcutaneous layer the green-cyan fringe at ~160.
BODY_CYAN = (0.08, 0.62, 0.95, 1.0)
MUSCLE_CYAN = (0.20, 0.78, 1.00, 1.0)
FAT_GREEN = (0.22, 0.92, 0.62, 1.0)


def hologram_material(name: str, colour, strength: float, rim: float, alpha: float,
                     base: float = 0.0):
    """Emission through a Fresnel rim, mixed with transparency.

    `rim` is the exponent: higher makes the glow hug the silhouette more
    tightly, which is what separates a surface you see through from a surface
    that is merely translucent.

    `base` adds glow that does not depend on viewing angle. It exists for the
    muscles. Given a rim, every volume draws its own outline, and two dozen
    outlined ellipsoids inside a body read as bubbles rather than as anatomy —
    which is exactly how the first render came out. With the rim dropped and a
    flat base instead, they read as soft masses seen through the skin, which is
    what the references actually show.
    """
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    tree.nodes.clear()

    output = tree.nodes.new('ShaderNodeOutputMaterial')
    mix = tree.nodes.new('ShaderNodeMixShader')
    transparent = tree.nodes.new('ShaderNodeBsdfTransparent')
    emission = tree.nodes.new('ShaderNodeEmission')
    fresnel = tree.nodes.new('ShaderNodeFresnel')
    power = tree.nodes.new('ShaderNodeMath')
    scale = tree.nodes.new('ShaderNodeMath')

    fresnel.inputs['IOR'].default_value = 1.35
    power.operation = 'POWER'
    power.inputs[1].default_value = rim
    scale.operation = 'MULTIPLY'
    scale.inputs[1].default_value = alpha

    floor = tree.nodes.new('ShaderNodeMath')
    floor.operation = 'ADD'
    floor.inputs[1].default_value = base
    clamp = tree.nodes.new('ShaderNodeClamp')

    emission.inputs['Color'].default_value = colour
    emission.inputs['Strength'].default_value = strength

    tree.links.new(fresnel.outputs['Fac'], power.inputs[0])
    tree.links.new(power.outputs[0], scale.inputs[0])
    tree.links.new(scale.outputs[0], floor.inputs[0])
    tree.links.new(floor.outputs[0], clamp.inputs['Value'])
    tree.links.new(clamp.outputs['Result'], mix.inputs['Fac'])
    tree.links.new(transparent.outputs['BSDF'], mix.inputs[1])
    tree.links.new(emission.outputs['Emission'], mix.inputs[2])
    tree.links.new(mix.outputs['Shader'], output.inputs['Surface'])

    return material


def setup_scene(samples: int, width: int, height: int) -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    # Nothing casts light on anything, so the only bounces that matter are the
    # transparent ones — and those have to be deep, or the far side of a body
    # made of two dozen overlapping volumes goes black.
    scene.cycles.transparent_max_bounces = 64
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 0
    scene.cycles.glossy_bounces = 0
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'


def load_model(path: str) -> bpy.types.Object:
    """Imports an anatomy mesh and fits it to the figure's height.

    This is the path that actually reaches the reference renders. Everything
    else in this file — the shader, the orbit, the framing, the alpha — works
    the same whether the body came from `build_skin` or from a sculpted mesh;
    only the geometry is different, and the geometry is the part that has to be
    bought or commissioned rather than written.

    Accepts .glb/.gltf, .fbx and .obj.
    """
    if not os.path.isfile(path):
        raise SystemExit(f'no model at {path}')

    extension = os.path.splitext(path)[1].lower()
    before = set(bpy.context.scene.objects)

    if extension in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif extension == '.fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    elif extension == '.obj':
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise SystemExit(f'unsupported model format: {extension}')

    imported = [
        obj for obj in set(bpy.context.scene.objects) - before if obj.type == 'MESH'
    ]
    if not imported:
        raise SystemExit(f'no mesh found in {path}')

    bpy.ops.object.select_all(action='DESELECT')
    for obj in imported:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = imported[0]
    if len(imported) > 1:
        bpy.ops.object.join()
    model = bpy.context.active_object

    # Models arrive at every scale and sitting anywhere. Normalise to the same
    # height and footing the procedural body uses, so a swapped mesh needs no
    # other change and the camera framing still holds.
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    lowest = min((model.matrix_world @ Vector(c)).z for c in model.bound_box)
    highest = max((model.matrix_world @ Vector(c)).z for c in model.bound_box)
    span = highest - lowest
    if span <= 0:
        raise SystemExit('the model has no height')

    scale = HEIGHT / span
    model.scale = Vector((scale, scale, scale))
    bpy.context.view_layer.update()

    lowest = min((model.matrix_world @ Vector(c)).z for c in model.bound_box)
    centre_x = sum((model.matrix_world @ Vector(c)).x for c in model.bound_box) / 8
    centre_y = sum((model.matrix_world @ Vector(c)).y for c in model.bound_box) / 8
    model.location = Vector((
        model.location.x - centre_x,
        model.location.y - centre_y,
        model.location.z - lowest,
    ))

    for polygon in model.data.polygons:
        polygon.use_smooth = True
    return model


def build_figure(adiposity: float, muscle: float, segments: int,
                 model_path: str | None = None):
    if model_path is not None:
        model = load_model(model_path)
        model.data.materials.clear()
        model.data.materials.append(
            hologram_material('anatomy', MUSCLE_CYAN, 1.9, 1.9, 0.8, base=0.06)
        )
        pivot = bpy.data.objects.new('pivot', None)
        bpy.context.scene.collection.objects.link(pivot)
        model.parent = pivot
        return pivot

    return _build_procedural_figure(adiposity, muscle, segments)


def _build_procedural_figure(adiposity: float, muscle: float, segments: int):
    build = Build(adiposity=adiposity, muscle=muscle, segments=segments)

    muscles = build_muscles(build)
    # No rim on the muscles: a broad, flat glow so they read as masses under
    # the skin rather than as outlined shapes floating inside it.
    muscles.data.materials.append(
        hologram_material('muscle', MUSCLE_CYAN, 1.5, 0.6, 0.10, base=0.16)
    )

    skin = build_skin(build)
    skin.data.materials.append(hologram_material('skin', BODY_CYAN, 1.7, 2.0, 0.72, base=0.05))

    shell = build_fat_shell(build)
    shell.data.materials.append(hologram_material('fat', FAT_GREEN, 2.2, 3.4, 0.55))

    pivot = bpy.data.objects.new('pivot', None)
    bpy.context.scene.collection.objects.link(pivot)
    for obj in (muscles, skin, shell):
        obj.parent = pivot
    return pivot


def setup_camera(width: int, height: int) -> bpy.types.Object:
    data = bpy.data.cameras.new('camera')
    data.lens = 85
    camera = bpy.data.objects.new('camera', data)
    bpy.context.scene.collection.objects.link(camera)

    # Far enough back that an 85mm lens flattens the perspective, which is how
    # the references are shot: no foreshortening on the near arm.
    distance = HEIGHT * 3.4
    camera.location = Vector((0.0, -distance, HEIGHT * 0.52))
    camera.rotation_euler = (math.radians(90.0), 0.0, 0.0)
    bpy.context.scene.camera = camera
    return camera


def render_turntable(out_dir: str, frames: int, adiposity: float, muscle: float,
                     samples: int, width: int, height: int, segments: int,
                     model_path: str | None = None) -> None:
    setup_scene(samples, width, height)
    pivot = build_figure(adiposity, muscle, segments, model_path)
    setup_camera(width, height)

    os.makedirs(out_dir, exist_ok=True)
    scene = bpy.context.scene

    for index in range(frames):
        # The figure turns, not the camera: framing then cannot drift between
        # frames, which is the failure that makes a turntable jitter.
        pivot.rotation_euler = (0.0, 0.0, (index / frames) * math.tau)
        scene.render.filepath = os.path.join(out_dir, f'frame-{index:02d}.png')
        bpy.ops.render.render(write_still=True)
        print(f'  frame {index + 1}/{frames}', flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='out')
    parser.add_argument('--frames', type=int, default=11)
    parser.add_argument('--adiposity', type=float, default=0.3, help='0..1')
    parser.add_argument('--muscle', type=float, default=0.55, help='0..1')
    parser.add_argument('--samples', type=int, default=48)
    parser.add_argument('--width', type=int, default=900)
    parser.add_argument('--height', type=int, default=1600)
    parser.add_argument('--segments', type=int, default=32)
    parser.add_argument(
        '--model',
        help='an anatomy mesh (.glb/.gltf/.fbx/.obj) to render instead of the '
             'procedural body. This is the path to the reference renders.',
    )
    args = parser.parse_args()

    render_turntable(
        args.out, args.frames, args.adiposity, args.muscle,
        args.samples, args.width, args.height, args.segments, args.model,
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
