"""Pass 8 for the owl: a 3D blockout in Blender, built from the same constants as owl.py.

Run headless from the repo root:

    blender -b -P docs/design/character-system/src/blockout.py

Writes png/14-blockout-*.png, models/organizer-blockout.glb and models/organizer-blockout.blend.
Primitives only. Workbench renderer with flat object colors and an outline, so the result
is a shape test, not a look test. One 2D unit is one centimetre; the figure is 3.2 m tall
in Blender for convenient camera framing.
"""

from __future__ import annotations

import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, ".."))
PNG = os.path.join(ROOT, "png")
MODELS = os.path.join(ROOT, "models")
os.makedirs(MODELS, exist_ok=True)

# Colors from owl.py, as linear-ish floats. Workbench takes object colors.
def hexf(h: str):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return (r ** 2.2, g ** 2.2, b ** 2.2, 1.0)


BACK = hexf("#CBA65C")
FACE = hexf("#F1E6CF")
APRON = hexf("#4A5C8A")
SCARF = hexf("#D9694F")
SLATE = hexf("#4B4F63")
INK = hexf("#2B2A28")
WHITE = (1, 1, 1, 1)
PAPER = hexf("#F6F1E7")
GREEN = hexf("#2F5D3A")

# 2D constants (owl.py), y measured down from the top of the 340 box, ground at 320.
def z_of(y2d: float) -> float:
    return (320.0 - y2d) / 100.0


# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "OBJECT"
scene.display.shading.show_object_outline = True
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = False
scene.display.shading.background_type = "WORLD"
world = bpy.data.worlds.new("Paper")
scene.world = world
world.color = PAPER[:3]
scene.render.resolution_x = 800
scene.render.resolution_y = 1000
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"

parts = {}


def add(name, kind, loc, scale=(1, 1, 1), rot=(0, 0, 0), color=BACK, parent=None, **kw):
    if kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=48, ring_count=24, location=loc)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(radius1=1, radius2=0, depth=1, vertices=kw.get("vertices", 32), location=loc)
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=1, vertices=32, location=loc)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=kw.get("minor", 0.25), location=loc)
    elif kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
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


def patch(name, center, scale, keep, color, parent=None, grow=1.02):
    """A surface patch: a sphere slightly larger than its host, keeping only the vertices
    where keep(x, y, z) is true in unit-sphere coordinates. Paint regions, not bulges."""
    import bmesh
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=160, ring_count=80, location=center)
    ob = bpy.context.active_object
    ob.name = name
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    doomed = [v for v in bm.verts if not keep(v.co.x, v.co.y, v.co.z)]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.scale = tuple(s * grow for s in scale)
    ob.color = color
    bpy.ops.object.shade_smooth()
    if parent is not None:
        ob.parent = parent
        ob.matrix_parent_inverse = parent.matrix_world.inverted()
    parts[name] = ob
    return ob


def empty(name, loc):
    bpy.ops.object.empty_add(location=loc)
    ob = bpy.context.active_object
    ob.name = name
    parts[name] = ob
    return ob


# Pivots as empties: hips, neck, shoulders. Children rotate about them.
hips = empty("hips", (0, 0, z_of(296)))
neck = empty("neck", (0, 0, z_of(160)))
neck.parent = hips
neck.matrix_parent_inverse = hips.matrix_world.inverted()
sh_near = empty("shoulder-near", (0.52, 0, z_of(192)))
sh_far = empty("shoulder-far", (-0.52, 0, z_of(192)))
for s in (sh_near, sh_far):
    s.parent = hips
    s.matrix_parent_inverse = hips.matrix_world.inverted()

# Body: egg 154 wide, 150 tall, widest above the middle.
add("body", "sphere", (0, 0, z_of(226)), scale=(0.77, 0.70, 0.76), parent=hips)
BODY_C, BODY_S = (0, 0, z_of(226)), (0.77, 0.70, 0.76)
patch("belly", BODY_C, BODY_S, lambda x, y, z: y < -0.45 and abs(x) < 0.66 and -0.85 < z < 0.75, FACE, parent=hips, grow=1.015)
add("tail", "cone", (0, 0.62, z_of(276)), scale=(0.10, 0.12, 0.26), rot=(-110, 0, 0), parent=hips)

# Head: circle radius 52 centred 46 above the neck.
add("head", "sphere", (0, 0, z_of(114)), scale=(0.52, 0.52, 0.52), parent=neck)
HEAD_C3, HEAD_S = (0, 0, z_of(114)), (0.52, 0.52, 0.52)
patch("disc", HEAD_C3, HEAD_S, lambda x, y, z: y < -0.28 and abs(x) < 0.86 and -0.72 < z < 0.62 and not (abs(x) < 0.14 and z > 0.22), FACE, parent=neck, grow=1.015)
for sx, nm in ((-1, "eye-l"), (1, "eye-r")):
    add(nm, "sphere", (sx * 0.19, -0.46, z_of(116)), scale=(0.12, 0.10, 0.12), color=INK, parent=neck)
    add(nm + "-shine", "sphere", (sx * 0.19 + 0.04, -0.555, z_of(111)), scale=(0.035, 0.03, 0.03), color=WHITE, parent=neck)
add("beak", "cone", (0, -0.55, z_of(132)), scale=(0.07, 0.07, 0.18), rot=(-100, 0, 0), color=SLATE, parent=neck)
add("tuft-l", "cone", (-0.36, -0.02, z_of(62)), scale=(0.12, 0.10, 0.32), rot=(0, -18, 0), parent=neck)
add("tuft-r", "cone", (0.36, -0.02, z_of(62)), scale=(0.12, 0.10, 0.32), rot=(0, 18, 0), parent=neck)

# Scarf: one band and one tail.
add("scarf", "torus", (0, 0, z_of(158)), scale=(0.44, 0.40, 1.0), color=SCARF, parent=hips, minor=0.18)
add("scarf-tail", "cube", (0.18, -0.62, z_of(182)), scale=(0.16, 0.06, 0.36), rot=(0, 0, -8), color=SCARF, parent=hips)

# Apron: a thin slab bent by a simple deform, over the belly.
patch("apron", BODY_C, BODY_S, lambda x, y, z: y < -0.20 and abs(x) < 0.62 - 0.12 * z and -0.92 < z < 0.28, APRON, parent=hips, grow=1.03)
patch("apron-pocket", BODY_C, BODY_S, lambda x, y, z: y < -0.5 and abs(x) < 0.20 and -0.42 < z < -0.14, hexf("#3B4A70"), parent=hips, grow=1.04)

# Wings: teardrops, pivoting at the shoulders.
add("wing-near", "sphere", (0.62, 0.02, z_of(238)), scale=(0.18, 0.16, 0.42), rot=(0, 12, 0), parent=sh_near)
add("wing-far", "sphere", (-0.62, 0.02, z_of(238)), scale=(0.18, 0.16, 0.42), rot=(0, -12, 0), parent=sh_far)

# Legs and feet.
for sx, nm in ((-1, "l"), (1, "r")):
    add(f"leg-{nm}", "cylinder", (sx * 0.20, 0, z_of(300)), scale=(0.045, 0.045, 0.24), color=SLATE)
    add(f"foot-{nm}", "cone", (sx * 0.22, -0.10, 0.06), scale=(0.30, 0.34, 0.12), rot=(0, 0, 90 + sx * 12), color=SLATE, vertices=3)

# Ground and wall for the storyboard camera.
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
ground = bpy.context.active_object
ground.name = "ground"
ground.color = hexf("#A8743F")
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 2.2, 3))
wall = bpy.context.active_object
wall.name = "wall"
wall.rotation_euler = (math.radians(90), 0, 0)
wall.color = GREEN

# Camera and views.
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


VIEWS = {
    "storyboard": ((4.0, -5.8, 3.4), (0, 0, 1.3)),   # three-quarter, slightly above, the storyboard camera
    "front": ((0, -7.0, 1.6), (0, 0, 1.6)),
    "side": ((7.0, 0, 1.6), (0, 0, 1.6)),
    "table": ((2.4, -4.4, 4.6), (0, 0, 1.2)),        # the mobile worktable, steeper
}


def render(name, w=800, h=1000):
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(PNG, f"14-blockout-{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", scene.render.filepath)


for name, (loc, target) in VIEWS.items():
    cam.location = loc
    look_at(cam, target)
    render(name)

# Small-size check: the storyboard view at 64 px tall.
cam.location, target = VIEWS["storyboard"]
look_at(cam, target)
render("storyboard-64px", 52, 64)

# Deformation test: head tilt 20 and near wing to 150, then lean 14 at the hips.
neck.rotation_euler = (math.radians(-20), 0, 0)
sh_near.rotation_euler = (0, math.radians(-150), 0)
render("deform-head-wing")
neck.rotation_euler = (0, 0, 0)
sh_near.rotation_euler = (0, 0, 0)
hips.rotation_euler = (math.radians(14), 0, 0)
render("deform-lean")
hips.rotation_euler = (0, 0, 0)

# Export for three.js and save the source.
bpy.ops.object.select_all(action="DESELECT")
for ob in parts.values():
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, "organizer-blockout.glb"), export_format="GLB",
                          use_selection=True, export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MODELS, "organizer-blockout.blend"))
print("blockout done")
