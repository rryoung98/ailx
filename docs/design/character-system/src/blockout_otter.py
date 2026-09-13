"""Cycle 3: the otter blockout in Blender, from the constants in otter.py.

    blender -b -P docs/design/character-system/src/blockout_otter.py

Writes png/16-blockout-*.png, models/otter-blockout.glb and .blend. Same method as the
owl blockout: primitives, surface patches for paint regions, Workbench render.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
PNG = os.path.join(ROOT, "png")
MODELS = os.path.join(ROOT, "models")
os.makedirs(MODELS, exist_ok=True)


def hexf(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return (r ** 2.2, g ** 2.2, b ** 2.2, 1.0)


FUR = hexf("#6E4B33"); FACE = hexf("#F1E6CF"); APRON = hexf("#9BAE91"); APRON_DARK = hexf("#7E9276")
SCARF = hexf("#4A5C8A"); INK = hexf("#2B2A28"); WHITE = (1, 1, 1, 1); BLUSH = hexf("#EFB6A4")
PAPER = hexf("#F6F1E7"); GREEN = hexf("#2F5D3A"); WOOD = hexf("#A8743F")


def z_of(y2d):
    return (320.0 - y2d) / 100.0


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
sh = scene.display.shading
sh.light, sh.color_type, sh.show_object_outline, sh.show_shadows, sh.background_type = "STUDIO", "OBJECT", True, True, "WORLD"
world = bpy.data.worlds.new("Paper"); scene.world = world; world.color = PAPER[:3]
scene.view_settings.view_transform = "Standard"
parts = {}


def finish(ob, name, scale, rot, color, parent):
    ob.name = name
    ob.scale = scale
    ob.rotation_euler = tuple(math.radians(a) for a in rot)
    ob.color = color
    bpy.ops.object.shade_smooth()
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    parts[name] = ob
    return ob


def add(name, kind, loc, scale=(1, 1, 1), rot=(0, 0, 0), color=FUR, parent=None, **kw):
    if kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=48, ring_count=24, location=loc)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(radius1=1, radius2=kw.get("r2", 0), depth=1, vertices=32, location=loc)
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=1, vertices=32, location=loc)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=kw.get("minor", 0.25), location=loc)
    return finish(bpy.context.active_object, name, scale, rot, color, parent)


def patch(name, center, scale, keep, color, parent=None, grow=1.02):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=160, ring_count=80, location=center)
    ob = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co.x, v.co.y, v.co.z)], context="VERTS")
    bm.to_mesh(ob.data); bm.free()
    return finish(ob, name, tuple(s * grow for s in scale), (0, 0, 0), color, parent)


def empty(name, loc, parent=None):
    bpy.ops.object.empty_add(location=loc)
    ob = bpy.context.active_object; ob.name = name; parts[name] = ob
    if parent is not None:
        ob.parent = parent; ob.matrix_parent_inverse = parent.matrix_world.inverted()
    return ob


hips = empty("hips", (0, 0, z_of(296)))
neck = empty("neck", (0, 0, z_of(162)), hips)
sh_near = empty("shoulder-near", (0.48, 0, z_of(190)), hips)
sh_far = empty("shoulder-far", (-0.48, 0, z_of(190)), hips)

# Body: egg 142 wide, 150 tall; chest and apron as patches.
BODY_C, BODY_S = (0, 0, z_of(226)), (0.71, 0.66, 0.76)
add("body", "sphere", BODY_C, BODY_S, parent=hips)
patch("chest", BODY_C, BODY_S, lambda x, y, z: y < -0.45 and abs(x) < 0.62 and -0.85 < z < 0.8, FACE, hips, 1.015)
patch("apron", BODY_C, BODY_S, lambda x, y, z: y < -0.2 and abs(x) < 0.62 - 0.12 * z and -0.92 < z < 0.3, APRON, hips, 1.03)
patch("apron-pocket", BODY_C, BODY_S, lambda x, y, z: y < -0.5 and abs(x) < 0.2 and -0.42 < z < -0.14, APRON_DARK, hips, 1.04)

# Head: ellipse 112 x 96, face mask as a patch, ears, eyes, nose.
HEAD_C3, HEAD_S = (0, 0, z_of(114)), (0.56, 0.50, 0.48)
add("head", "sphere", HEAD_C3, HEAD_S, parent=neck)
patch("face", HEAD_C3, HEAD_S, lambda x, y, z: y < -0.35 and abs(x) < 0.8 and -0.95 < z < 0.45, FACE, neck, 1.015)
for sx, nm in ((-1, "l"), (1, "r")):
    add(f"ear-{nm}", "sphere", (sx * 0.46, 0.02, z_of(78)), (0.11, 0.09, 0.11), parent=neck)
    add(f"ear-{nm}-inner", "sphere", (sx * 0.46, -0.06, z_of(78)), (0.05, 0.03, 0.05), color=hexf("#D9CBAA"), parent=neck)
    add(f"eye-{nm}", "sphere", (sx * 0.19, -0.44, z_of(116)), (0.11, 0.09, 0.11), color=INK, parent=neck)
    add(f"eye-{nm}-shine", "sphere", (sx * 0.19 + 0.04, -0.535, z_of(111)), (0.03, 0.025, 0.03), color=WHITE, parent=neck)
    add(f"blush-{nm}", "sphere", (sx * 0.34, -0.40, z_of(132)), (0.09, 0.02, 0.05), color=BLUSH, parent=neck)
add("nose", "sphere", (0, -0.52, z_of(130)), (0.07, 0.05, 0.05), color=INK, parent=neck)

# Scarf and its tail.
add("scarf", "torus", (0, 0, z_of(160)), (0.42, 0.38, 1.0), color=SCARF, parent=hips, minor=0.18)
add("scarf-tail", "cone", (0.16, -0.56, z_of(184)), (0.08, 0.05, 0.36), rot=(180, 0, -8), color=SCARF, parent=hips, r2=0.6)

# Paws: capsule arm and a mitt, pivoting at the shoulders.
for s, sx, nm in ((sh_near, 1, "near"), (sh_far, -1, "far")):
    # arms sit outside the body surface (half-width 0.71) and a little forward
    add(f"arm-{nm}", "cylinder", (sx * 0.74, -0.16, z_of(214)), (0.11, 0.11, 0.44), rot=(0, sx * 8, 0), parent=s)
    add(f"mitt-{nm}", "sphere", (sx * 0.78, -0.20, z_of(242)), (0.15, 0.13, 0.15), parent=s)

# Legs, flipper feet, tail.
for sx, nm in ((-1, "l"), (1, "r")):
    add(f"leg-{nm}", "cylinder", (sx * 0.2, 0, z_of(298)), (0.08, 0.08, 0.22))
    add(f"foot-{nm}", "sphere", (sx * 0.22, -0.12, 0.07), (0.22, 0.3, 0.07), rot=(0, 0, sx * 12))
# tail: base buried in the lower back at (0, 0.5, 0.55), tip on the ground behind
add("tail", "cone", (0, 1.09, 0.28), (0.17, 0.12, 1.3), rot=(-114, 0, 0), r2=0.05)

# Ground and wall.
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0)); g = bpy.context.active_object; g.name = "ground"; g.color = WOOD
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 2.2, 3)); w = bpy.context.active_object; w.name = "wall"; w.rotation_euler = (math.radians(90), 0, 0); w.color = GREEN

cam_data = bpy.data.cameras.new("cam"); cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam


def look_at(ob, target):
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()


VIEWS = {"storyboard": ((4.0, -5.8, 3.4), (0, 0, 1.3)), "front": ((0, -7.0, 1.6), (0, 0, 1.6)),
         "side": ((7.0, 0, 1.6), (0, 0, 1.6)), "table": ((2.4, -4.4, 4.6), (0, 0, 1.2))}


def render(name, w=800, h=1000):
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(PNG, f"16-blockout-{name}.png")
    bpy.ops.render.render(write_still=True)


for name, (loc, target) in VIEWS.items():
    cam.location = loc; look_at(cam, target); render(name)
cam.location, target = VIEWS["storyboard"]; look_at(cam, target); render("storyboard-64px", 52, 64)
neck.rotation_euler = (math.radians(-20), 0, 0); sh_near.rotation_euler = (0, math.radians(-150), 0); render("deform-head-wing")
neck.rotation_euler = (0, 0, 0); sh_near.rotation_euler = (0, 0, 0); hips.rotation_euler = (math.radians(14), 0, 0); render("deform-lean")
hips.rotation_euler = (0, 0, 0)

bpy.ops.object.select_all(action="DESELECT")
for ob in parts.values():
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, "otter-blockout.glb"), export_format="GLB", use_selection=True, export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODELS, "otter-blockout.blend"))
print("blockout done")
