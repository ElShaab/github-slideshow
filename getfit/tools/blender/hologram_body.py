"""
The hologram body, built for Blender.

Geometry only: a skin surface and the muscle volumes inside it. Shading and the
turntable live in `hologram_turntable.py`, so this file can be imported and
inspected without rendering anything.

The body is a loft — a stack of elliptical rings, same idea as the app's mesh,
because the two have to stay the same person. The muscles are ellipsoids placed
at anatomical landmarks. That is a real approximation and not a hidden one: a
deltoid is not an ellipsoid. But under a transparent, emissive shader what the
eye reads is the volume and its edge, and twenty-five correctly placed volumes
seen through skin read as a body far better than one smooth surface does.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import bpy  # type: ignore
import bmesh  # type: ignore
from mathutils import Euler, Vector  # type: ignore

# Everything is in metres, with the feet at z=0.
HEIGHT = 1.80

# Heights up the body, as a fraction of total height. These follow the app's
# landmarks so the rendered figure and the drawn one share proportions.
Y = {
    'foot': 0.000,
    'ankle': 0.039,
    'calf': 0.135,
    'knee': 0.246,
    'thigh': 0.354,
    'crotch': 0.480,
    'hip': 0.530,
    'waist': 0.585,
    'belly': 0.625,
    'chest': 0.715,
    'armpit': 0.748,
    'shoulder': 0.800,
    'neck': 0.838,
    'chin': 0.868,
    'brow': 0.928,
    'head_top': 0.982,
}


def z(landmark: str) -> float:
    return Y[landmark] * HEIGHT


@dataclass
class Ring:
    """One cross-section: an ellipse at a height, offset from the centre line."""

    z: float
    half_width: float
    half_depth: float
    x: float = 0.0
    y: float = 0.0


@dataclass
class Build:
    """How heavy and how muscular the figure is, 0..1 each."""

    adiposity: float = 0.25
    muscle: float = 0.55
    # Everything below scales off the height, so the proportions hold if the
    # figure is ever rendered at another size.
    segments: int = 32
    name: str = 'body'
    muscle_volumes: list = field(default_factory=list)


def _loft(rings: list[Ring], segments: int, name: str) -> bpy.types.Object:
    """Builds a closed surface through a stack of rings, capped at both ends."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()

    layers = []
    for ring in rings:
        layer = []
        for s in range(segments):
            angle = (s / segments) * math.tau
            layer.append(
                bm.verts.new(
                    (
                        ring.x + math.cos(angle) * ring.half_width,
                        ring.y + math.sin(angle) * ring.half_depth,
                        ring.z,
                    )
                )
            )
        layers.append(layer)

    bm.verts.ensure_lookup_table()
    for lower, upper in zip(layers, layers[1:]):
        for s in range(segments):
            n = (s + 1) % segments
            bm.faces.new((lower[s], lower[n], upper[n], upper[s]))

    # Caps. An open tube shows its own inside through a transparent shader,
    # which reads as a hole rather than as a limb.
    bm.faces.new(tuple(reversed(layers[0])))
    bm.faces.new(tuple(layers[-1]))

    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def _trunk_rings(build: Build) -> list[Ring]:
    fat = build.adiposity
    mus = build.muscle
    h = HEIGHT

    shoulder = h * (0.108 + mus * 0.018)
    chest = h * (0.086 + mus * 0.012 + fat * 0.009)
    belly = h * (0.063 + fat * 0.050 + mus * 0.005)
    waist = h * (0.057 + fat * 0.046)
    hip = h * (0.075 + fat * 0.026)

    return [
        Ring(z('crotch') - 0.01, hip * 0.86, hip * 0.74),
        Ring(z('hip'), hip, hip * 0.74),
        Ring(z('waist'), waist, waist * 0.84),
        Ring(z('belly'), belly, belly * 0.86),
        Ring(z('chest'), chest, chest * 0.74),
        Ring(z('armpit'), chest * 1.02, chest * 0.70),
        Ring(z('shoulder'), shoulder * 0.92, chest * 0.62),
        Ring(z('neck'), h * 0.036, h * 0.036),
        Ring(z('chin') - 0.005, h * 0.034, h * 0.036),
    ]


def _head_rings() -> list[Ring]:
    h = HEIGHT
    return [
        Ring(z('chin') - 0.010, h * 0.030, h * 0.034),
        Ring(z('chin') + 0.018, h * 0.044, h * 0.052),
        Ring(z('brow') - 0.020, h * 0.052, h * 0.062),
        Ring(z('brow') + 0.012, h * 0.050, h * 0.060),
        Ring(z('head_top') - 0.018, h * 0.040, h * 0.046),
        Ring(z('head_top'), h * 0.012, h * 0.014),
    ]


def _arm_rings(build: Build, side: int) -> list[Ring]:
    h = HEIGHT
    mus = build.muscle
    fat = build.adiposity
    upper = h * (0.030 + mus * 0.016 + fat * 0.006)
    fore = h * (0.025 + mus * 0.011 + fat * 0.004)

    # Held about 12 degrees clear of the body, which is what lets the lat and
    # the serratus be seen at all.
    shoulder_x = h * (0.108 + mus * 0.016)
    elbow_x = shoulder_x + h * 0.030
    wrist_x = shoulder_x + h * 0.055

    return [
        Ring(z('thigh') + 0.02, fore * 0.40, fore * 0.30, side * (wrist_x + h * 0.004)),
        Ring(z('crotch') - 0.01, fore * 0.62, fore * 0.52, side * wrist_x),
        Ring(z('hip') + 0.02, fore * 0.78, fore * 0.66, side * (wrist_x - h * 0.004)),
        Ring(z('waist') + 0.02, fore * 0.96, fore * 0.82, side * ((elbow_x + wrist_x) / 2)),
        Ring(z('belly') + 0.03, upper * 0.80, upper * 0.72, side * elbow_x),
        Ring(z('chest') - 0.01, upper * 1.00, upper * 0.88, side * ((shoulder_x + elbow_x) / 2)),
        Ring(z('armpit') + 0.01, upper * 1.06, upper * 0.94, side * (shoulder_x + h * 0.004)),
        Ring(z('shoulder') + 0.005, upper * 0.88, upper * 0.80, side * shoulder_x),
    ]


def _leg_rings(build: Build, side: int) -> list[Ring]:
    h = HEIGHT
    mus = build.muscle
    fat = build.adiposity
    thigh = h * (0.058 + mus * 0.018 + fat * 0.016)
    knee = h * (0.038 + fat * 0.005)
    calf = h * (0.038 + mus * 0.012 + fat * 0.008)
    ankle = h * (0.024 + fat * 0.003)

    hip_x = h * (0.048 + fat * 0.010)
    ankle_x = hip_x * 0.80

    return [
        Ring(z('foot') + 0.004, ankle * 1.1, ankle * 2.6, side * ankle_x, HEIGHT * 0.022),
        Ring(z('ankle'), ankle, ankle * 1.05, side * ankle_x),
        Ring(z('calf'), calf, calf * 1.06, side * ankle_x),
        Ring(z('knee'), knee, knee * 1.02, side * (hip_x * 0.92)),
        Ring(z('thigh'), thigh, thigh * 1.02, side * hip_x),
        Ring(z('crotch') + 0.01, thigh * 1.04, thigh * 1.0, side * hip_x),
    ]


def _smooth(obj: bpy.types.Object, levels: int = 2) -> None:
    """Subdivision plus smooth shading: the loft is too faceted without it."""
    modifier = obj.modifiers.new('subsurf', 'SUBSURF')
    modifier.levels = levels
    modifier.render_levels = levels
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def build_skin(build: Build) -> bpy.types.Object:
    """The outer surface: trunk, head, arms and legs joined into one object."""
    parts = [
        _loft(_trunk_rings(build), build.segments, f'{build.name}-trunk'),
        _loft(_head_rings(), build.segments, f'{build.name}-head'),
        _loft(_arm_rings(build, -1), build.segments, f'{build.name}-arm-l'),
        _loft(_arm_rings(build, 1), build.segments, f'{build.name}-arm-r'),
        _loft(_leg_rings(build, -1), build.segments, f'{build.name}-leg-l'),
        _loft(_leg_rings(build, 1), build.segments, f'{build.name}-leg-r'),
    ]

    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()

    skin = bpy.context.active_object
    skin.name = f'{build.name}-skin'
    _smooth(skin)
    return skin


# The muscle map: name, centre as (x, z) fractions, size, and rotation.
#
# `x` is a fraction of half the shoulder width and mirrors, so a wider figure
# gets wider-set muscles rather than the same ones further apart. `z` is a
# fraction of height. Sizes are fractions of height. Nothing here is an
# anatomically correct shape — a deltoid is not an ellipsoid — but placement
# and proportion are what the eye reads through a transparent surface, and
# those are right.
MUSCLES = [
    # name,            x,     z,      rx,    ry,    rz,    tilt°, mirror
    ('deltoid',        0.86,  0.775,  0.036, 0.034, 0.040,  0,     True),
    ('pectoral',       0.38,  0.722,  0.052, 0.030, 0.034, -12,    True),
    ('trapezius',      0.30,  0.806,  0.046, 0.030, 0.026,  0,     True),
    ('lat',            0.62,  0.690,  0.030, 0.034, 0.058,  10,    True),
    ('serratus',       0.52,  0.668,  0.020, 0.024, 0.026,  0,     True),
    ('biceps',         0.92,  0.700,  0.024, 0.024, 0.040,  4,     True),
    ('triceps',        0.92,  0.712,  0.022, 0.026, 0.044,  4,     True),
    ('forearm',        1.02,  0.605,  0.021, 0.021, 0.048,  6,     True),
    # The abdominal wall, as stacked blocks either side of the linea alba.
    ('rectus-1',       0.13,  0.664,  0.026, 0.020, 0.018,  0,     True),
    ('rectus-2',       0.13,  0.630,  0.026, 0.020, 0.018,  0,     True),
    ('rectus-3',       0.12,  0.598,  0.024, 0.020, 0.017,  0,     True),
    ('rectus-4',       0.11,  0.568,  0.022, 0.019, 0.018,  0,     True),
    ('oblique',        0.40,  0.606,  0.022, 0.026, 0.044,  8,     True),
    ('glute',          0.44,  0.506,  0.036, 0.034, 0.030,  0,     True),
    ('quad-rectus',    0.42,  0.400,  0.028, 0.028, 0.070,  2,     True),
    ('quad-lateralis', 0.56,  0.410,  0.024, 0.026, 0.062,  4,     True),
    ('quad-medialis',  0.32,  0.320,  0.022, 0.024, 0.044,  2,     True),
    ('hamstring',      0.44,  0.390,  0.026, 0.026, 0.066,  2,     True),
    ('calf',           0.42,  0.170,  0.024, 0.026, 0.048,  2,     True),
    ('tibialis',       0.36,  0.165,  0.014, 0.016, 0.044,  2,     True),
    ('sternocleido',   0.14,  0.836,  0.010, 0.012, 0.022,  8,     True),
]


def build_muscles(build: Build) -> bpy.types.Object:
    """Every muscle volume, joined into one object so it takes one material."""
    h = HEIGHT
    half_shoulder = h * (0.118 + build.muscle * 0.020)
    # Muscle volumes grow with development and are pushed outwards a little by
    # the fat over them, which is why a heavier figure's muscles sit deeper.
    swell = 0.82 + build.muscle * 0.42

    created = []
    for name, x, zf, rx, ry, rz, tilt, mirror in MUSCLES:
        for side in ((-1, 1) if mirror else (0,)):
            bpy.ops.mesh.primitive_uv_sphere_add(
                segments=16, ring_count=10, radius=1.0,
                location=(side * x * half_shoulder, 0.0, zf * h),
            )
            obj = bpy.context.active_object
            obj.name = f'{build.name}-{name}{"" if side == 0 else ("-l" if side < 0 else "-r")}'
            obj.scale = Vector((rx * h * swell, ry * h * swell, rz * h * swell))
            obj.rotation_euler = Euler((0.0, math.radians(tilt * (side or 1)), 0.0), 'XYZ')
            bpy.ops.object.shade_smooth()
            created.append(obj)

    bpy.ops.object.select_all(action='DESELECT')
    for obj in created:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = created[0]
    bpy.ops.object.join()

    muscles = bpy.context.active_object
    muscles.name = f'{build.name}-muscles'
    return muscles


def build_fat_shell(build: Build) -> bpy.types.Object:
    """The subcutaneous layer: the skin again, pushed outwards.

    Thickness scales with adiposity, so on a lean figure it is a rim at the
    silhouette and on a heavy one it is a visible covering — the same idea the
    app draws in two dimensions, except here it genuinely encloses the body and
    therefore holds up from any angle.
    """
    shell = build_skin(Build(
        adiposity=build.adiposity,
        muscle=build.muscle,
        segments=build.segments,
        name=f'{build.name}-shell',
    ))
    solidify = shell.modifiers.new('fat', 'SOLIDIFY')
    solidify.thickness = HEIGHT * (0.004 + build.adiposity * 0.028)
    solidify.offset = 1.0
    return shell
