#!/usr/bin/env python3
"""Export Blender collections to separate GLB modules plus scene metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import traceback
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import bpy
from mathutils import Matrix, Vector

EXPORTABLE_TYPES = {
    "MESH", "CURVE", "SURFACE", "FONT", "META", "ARMATURE", "EMPTY"
}
BLENDER_TO_GLTF = Matrix.Rotation(math.radians(-90.0), 4, "X")


def args() -> argparse.Namespace:
    argv = sys.argv
    own = argv[argv.index("--") + 1:] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--recursive", action="store_true")
    parser.add_argument("--include-hidden", action="store_true")
    parser.add_argument("--skip-prefix", action="append", default=["__"])
    return parser.parse_args(own)


def slugify(name: str, used: set[str]) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")
    if not slug:
        slug = "collection-" + hashlib.sha1(name.encode()).hexdigest()[:8]
    base = slug
    n = 2
    while slug in used:
        slug = f"{base}-{n}"
        n += 1
    used.add(slug)
    return slug


def column_major(matrix: Matrix) -> list[float]:
    return [float(matrix[row][col]) for col in range(4) for row in range(4)]


def gltf_matrix(obj: bpy.types.Object) -> Matrix:
    return BLENDER_TO_GLTF @ obj.matrix_world @ BLENDER_TO_GLTF.inverted()


def gltf_position(vector: Vector) -> list[float]:
    value = BLENDER_TO_GLTF @ vector.to_4d()
    return [float(value.x), float(value.y), float(value.z)]


def rgb(color: Any) -> list[float]:
    return [float(color[0]), float(color[1]), float(color[2])]


def parent_map() -> dict[str, str | None]:
    result = {collection.name: None for collection in bpy.data.collections}
    for parent in bpy.data.collections:
        for child in parent.children:
            result[child.name] = parent.name
    return result


def depth(name: str, parents: dict[str, str | None]) -> int:
    result = 0
    current = parents.get(name)
    visited: set[str] = set()
    while current and current not in visited:
        visited.add(current)
        result += 1
        current = parents.get(current)
    return result


def all_layer_collections(layer: bpy.types.LayerCollection):
    yield layer
    for child in layer.children:
        yield from all_layer_collections(child)


def prepare_visibility() -> tuple[dict[str, tuple[bool, bool]], dict[str, tuple[bool, bool, bool, bool]]]:
    collection_states: dict[str, tuple[bool, bool]] = {}
    for collection in bpy.data.collections:
        collection_states[collection.name] = (collection.hide_viewport, collection.hide_render)
        collection.hide_viewport = False
        collection.hide_render = False

    for layer in all_layer_collections(bpy.context.view_layer.layer_collection):
        try:
            layer.exclude = False
            layer.hide_viewport = False
        except (AttributeError, RuntimeError):
            pass

    object_states: dict[str, tuple[bool, bool, bool, bool]] = {}
    for obj in bpy.context.scene.objects:
        try:
            hidden = obj.hide_get()
        except RuntimeError:
            hidden = False
        object_states[obj.name] = (obj.hide_viewport, obj.hide_render, obj.hide_select, hidden)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.hide_select = False
        try:
            obj.hide_set(False)
        except RuntimeError:
            pass

    bpy.context.view_layer.update()
    return collection_states, object_states


def restore_visibility(collection_states, object_states) -> None:
    for name, state in collection_states.items():
        collection = bpy.data.collections.get(name)
        if collection:
            collection.hide_viewport, collection.hide_render = state

    for name, state in object_states.items():
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        obj.hide_viewport, obj.hide_render, obj.hide_select = state[:3]
        try:
            obj.hide_set(state[3])
        except RuntimeError:
            pass


def deselect() -> None:
    for obj in list(bpy.context.selected_objects):
        obj.select_set(False)


def objects_for(collection: bpy.types.Collection, recursive: bool) -> list[bpy.types.Object]:
    source = collection.all_objects if recursive else collection.objects
    seen: set[int] = set()
    result: list[bpy.types.Object] = []
    for obj in source:
        pointer = obj.as_pointer()
        if pointer in seen or obj.type not in EXPORTABLE_TYPES:
            continue
        seen.add(pointer)
        result.append(obj)
    return result


def select(objects: list[bpy.types.Object]) -> list[bpy.types.Object]:
    deselect()
    selected: list[bpy.types.Object] = []
    for obj in objects:
        if obj.name not in bpy.context.view_layer.objects:
            print(f'WARNING: "{obj.name}" is outside the active view layer')
            continue
        try:
            obj.select_set(True)
            selected.append(obj)
        except RuntimeError as error:
            print(f'WARNING: cannot select "{obj.name}": {error}')
    bpy.context.view_layer.objects.active = selected[0] if selected else None
    return selected


def export_collection(collection: bpy.types.Collection, filepath: Path, recursive: bool) -> dict[str, Any] | None:
    candidates = objects_for(collection, recursive)
    selected = select(candidates)
    if not selected:
        return None

    filepath.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        check_existing=False,
        export_format="GLB",
        use_selection=True,
        use_visible=False,
        use_renderable=False,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_animations=True,
        export_optimize_animation_size=True,
        export_unused_images=False,
        export_unused_textures=False,
        export_draco_mesh_compression_enable=False,
    )
    deselect()
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed: {result}")

    selected_pointers = {obj.as_pointer() for obj in selected}
    external_parents = sorted({
        obj.parent.name
        for obj in selected
        if obj.parent and obj.parent.as_pointer() not in selected_pointers
    })
    type_counts: dict[str, int] = {}
    for obj in selected:
        type_counts[obj.type] = type_counts.get(obj.type, 0) + 1

    return {
        "objectCount": len(selected),
        "objectTypes": type_counts,
        "objects": sorted(obj.name for obj in selected),
        "externalParents": external_parents,
        "fileSizeBytes": filepath.stat().st_size,
    }


def default_visible(collection: bpy.types.Collection, original_state, include_hidden: bool) -> bool:
    if include_hidden:
        return True
    return not original_state[0] and not original_state[1]


def preview_intensity(light: bpy.types.Light) -> float:
    energy = max(float(light.energy), 0.0)
    factor = {"SUN": 0.001, "AREA": 0.02, "SPOT": 0.03, "POINT": 0.03}.get(light.type, 0.03)
    return max(0.05, energy * factor)


def light_payload(obj: bpy.types.Object) -> dict[str, Any]:
    light = obj.data
    matrix = gltf_matrix(obj)
    location, rotation, scale = matrix.decompose()
    payload: dict[str, Any] = {
        "name": obj.name,
        "dataName": light.name,
        "type": light.type,
        "color": rgb(light.color),
        "rawEnergy": float(light.energy),
        "previewIntensity": preview_intensity(light),
        "matrix": column_major(matrix),
        "position": list(map(float, location)),
        "quaternion": [float(rotation.x), float(rotation.y), float(rotation.z), float(rotation.w)],
        "scale": list(map(float, scale)),
        "enabled": not obj.hide_render,
        "useShadow": bool(getattr(light, "use_shadow", False)),
        "customDistance": bool(getattr(light, "use_custom_distance", False)),
        "distance": float(getattr(light, "cutoff_distance", 0.0)),
    }
    if light.type == "SPOT":
        payload.update(spotSize=float(light.spot_size), spotBlend=float(light.spot_blend))
    if light.type == "AREA":
        payload.update(shape=light.shape, size=float(light.size), sizeY=float(getattr(light, "size_y", light.size)))
    return payload


def camera_payload(obj: bpy.types.Object) -> dict[str, Any]:
    camera = obj.data
    matrix = gltf_matrix(obj)
    location, rotation, scale = matrix.decompose()
    focus_name = None
    focus_position = None
    if camera.dof.use_dof and camera.dof.focus_object:
        focus_name = camera.dof.focus_object.name
        focus_position = gltf_position(camera.dof.focus_object.matrix_world.translation)
    return {
        "name": obj.name,
        "dataName": camera.name,
        "type": camera.type,
        "matrix": column_major(matrix),
        "position": list(map(float, location)),
        "quaternion": [float(rotation.x), float(rotation.y), float(rotation.z), float(rotation.w)],
        "scale": list(map(float, scale)),
        "fovYDegrees": math.degrees(float(camera.angle_y)),
        "near": float(camera.clip_start),
        "far": float(camera.clip_end),
        "dof": {
            "enabled": bool(camera.dof.use_dof),
            "focusObject": focus_name,
            "focusPosition": focus_position,
            "focusDistance": float(camera.dof.focus_distance),
            "fStop": float(camera.dof.aperture_fstop),
            "blades": int(camera.dof.aperture_blades),
            "rotation": float(camera.dof.aperture_rotation),
            "ratio": float(camera.dof.aperture_ratio),
        },
    }


def scene_payload() -> dict[str, Any]:
    scene = bpy.context.scene
    world_color = rgb(scene.world.color) if scene.world else [0.02, 0.02, 0.02]
    return {
        "name": scene.name,
        "frame": int(scene.frame_current),
        "unitScale": float(scene.unit_settings.scale_length),
        "worldColor": world_color,
        "exposureStops": float(scene.view_settings.exposure),
        "viewTransform": str(scene.view_settings.look),
        "renderEngine": str(scene.render.engine),
        "resolution": [int(scene.render.resolution_x), int(scene.render.resolution_y)],
    }


def main() -> None:
    options = args()
    if not bpy.data.filepath:
        raise RuntimeError("The current Blender file has no filepath")

    output = Path(options.output).expanduser().resolve()
    manifest_path = Path(options.manifest).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    for old in output.glob("*.glb"):
        old.unlink()

    parents = parent_map()
    used_slugs: set[str] = set()
    collections = [
        c for c in bpy.data.collections
        if not any(c.name.startswith(prefix) for prefix in options.skip_prefix)
    ]
    collections.sort(key=lambda c: (depth(c.name, parents), c.name.casefold()))

    original_selection = [obj.name for obj in bpy.context.selected_objects]
    original_active = bpy.context.view_layer.objects.active.name if bpy.context.view_layer.objects.active else None
    collection_states, object_states = prepare_visibility()

    exported: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    try:
        for index, collection in enumerate(collections, start=1):
            slug = slugify(collection.name, used_slugs)
            file = output / f"{slug}.glb"
            print(f'[{index}/{len(collections)}] {collection.name} -> {file.name}')
            try:
                details = export_collection(collection, file, options.recursive)
                if details is None:
                    print("  skipped: no direct exportable objects")
                    continue
                exported.append({
                    "name": collection.name,
                    "slug": slug,
                    "file": file.name,
                    "parent": parents.get(collection.name),
                    "children": sorted(child.name for child in collection.children),
                    "depth": depth(collection.name, parents),
                    "defaultVisible": default_visible(collection, collection_states[collection.name], options.include_hidden),
                    "blenderHideViewport": bool(collection_states[collection.name][0]),
                    "blenderHideRender": bool(collection_states[collection.name][1]),
                    **details,
                })
            except Exception as error:
                failures.append({"collection": collection.name, "error": str(error)})
                print(f"ERROR: {error}")
                traceback.print_exc()
    finally:
        restore_visibility(collection_states, object_states)
        deselect()
        for name in original_selection:
            obj = bpy.data.objects.get(name)
            if obj:
                try:
                    obj.select_set(True)
                except RuntimeError:
                    pass
        if original_active:
            obj = bpy.data.objects.get(original_active)
            if obj:
                bpy.context.view_layer.objects.active = obj
        bpy.context.view_layer.update()

    scene = bpy.context.scene
    active_camera = scene.camera.name if scene.camera else None
    lights = [light_payload(obj) for obj in scene.objects if obj.type == "LIGHT"]
    cameras = [camera_payload(obj) for obj in scene.objects if obj.type == "CAMERA"]
    total_bytes = sum(item["fileSizeBytes"] for item in exported)

    manifest = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceBlend": Path(bpy.data.filepath).name,
        "exportMode": "recursive" if options.recursive else "direct",
        "coordinateSystem": "gltf-y-up",
        "scene": scene_payload(),
        "activeCamera": active_camera,
        "collections": exported,
        "lights": lights,
        "cameras": cameras,
        "failures": failures,
        "summary": {
            "collectionCount": len(exported),
            "lightCount": len(lights),
            "cameraCount": len(cameras),
            "totalGlbBytes": total_bytes,
        },
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print("\n" + "=" * 72)
    print("POWERBOX COLLECTION EXPORT COMPLETE")
    print(f"Collections: {len(exported)}")
    print(f"Lights: {len(lights)}")
    print(f"Cameras: {len(cameras)}")
    print(f"Total GLB: {total_bytes / 1024 / 1024:.2f} MiB")
    print(f"Manifest: {manifest_path}")

    if failures:
        raise RuntimeError(f"{len(failures)} collection export(s) failed")


if __name__ == "__main__":
    main()
