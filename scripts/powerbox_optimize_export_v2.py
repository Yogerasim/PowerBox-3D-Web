from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import struct
import sys
import traceback
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import bpy
from mathutils import Matrix, Vector


LIGHT_COLLECTION_NAMES = ("Led_Lights", "LED_Lights", "Led Lights")
SINGLE_MESH_COLLECTION_NAMES = (
    "Plugs",
    "Details_Box",
    "Socets",
    "Sockets",
)

EXPECTED_LIGHT_COUNT = 8
EXPECTED_SINGLE_CLUSTER_COUNTS = (9, 3)

PROTOTYPE_MASTER_NAME = "__WEB_PROTOTYPES"
TEXTURE_MARKER = "powerbox_texture_half_v2"
INSTANCE_MARKER = "powerbox_instances_v2"

GEOMETRY_TYPES = {"MESH", "CURVE", "SURFACE", "FONT", "META"}
EXPORTABLE_TYPES = GEOMETRY_TYPES | {"ARMATURE", "EMPTY"}

BLENDER_TO_GLTF = Matrix.Rotation(math.radians(-90.0), 4, "X")
NAME_SUFFIX = re.compile(r"^(.*?)(?:\.(\d{3}))?$")


def parse_arguments() -> argparse.Namespace:
    argv = sys.argv
    script_args = argv[argv.index("--") + 1:] if "--" in argv else []

    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--texture-scale", type=float, default=0.5)
    parser.add_argument("--force-textures", action="store_true")
    parser.add_argument("--allow-approximation", action="store_true")
    return parser.parse_args(script_args)


def deselect_all() -> None:
    for obj in list(bpy.context.selected_objects):
        obj.select_set(False)


def split_suffix(name: str) -> tuple[str, int]:
    match = NAME_SUFFIX.match(name)
    if match is None:
        return name, 0

    suffix = match.group(2)
    return match.group(1), int(suffix) if suffix else 0


def find_collection(names: tuple[str, ...]) -> bpy.types.Collection:
    for name in names:
        collection = bpy.data.collections.get(name)
        if collection is not None:
            return collection

    by_lower = {
        collection.name.casefold(): collection
        for collection in bpy.data.collections
    }

    for name in names:
        collection = by_lower.get(name.casefold())
        if collection is not None:
            return collection

    raise RuntimeError(
        "Не найдена коллекция. Ожидалось одно из имён: "
        + ", ".join(names)
    )


def find_existing_collections(
    names: tuple[str, ...],
) -> list[bpy.types.Collection]:
    wanted = {name.casefold() for name in names}

    return [
        collection
        for collection in bpy.data.collections
        if collection.name.casefold() in wanted
    ]


def ensure_prototype_master() -> bpy.types.Collection:
    collection = bpy.data.collections.get(PROTOTYPE_MASTER_NAME)

    if collection is None:
        collection = bpy.data.collections.new(PROTOTYPE_MASTER_NAME)

    scene_root = bpy.context.scene.collection

    if collection.name not in scene_root.children:
        try:
            scene_root.children.link(collection)
        except RuntimeError:
            pass

    collection.hide_viewport = True
    collection.hide_render = True
    return collection


def ensure_child_collection(
    parent: bpy.types.Collection,
    name: str,
) -> bpy.types.Collection:
    collection = bpy.data.collections.get(name)

    if collection is None:
        collection = bpy.data.collections.new(name)

    if collection.name not in parent.children:
        try:
            parent.children.link(collection)
        except RuntimeError:
            pass

    collection.hide_viewport = True
    collection.hide_render = True
    return collection


def unlink_from_all_collections(obj: bpy.types.Object) -> None:
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)


def matrix_to_array(matrix: Matrix) -> list[float]:
    return [
        float(matrix[row][column])
        for column in range(4)
        for row in range(4)
    ]


def converted_matrix(obj: bpy.types.Object) -> Matrix:
    return BLENDER_TO_GLTF @ obj.matrix_world @ BLENDER_TO_GLTF.inverted()


def local_bbox_volume(obj: bpy.types.Object) -> float:
    if not getattr(obj, "bound_box", None):
        return 0.0

    points = [Vector(point) for point in obj.bound_box]
    minimum = Vector(
        (
            min(point.x for point in points),
            min(point.y for point in points),
            min(point.z for point in points),
        )
    )
    maximum = Vector(
        (
            max(point.x for point in points),
            max(point.y for point in points),
            max(point.z for point in points),
        )
    )

    dimensions = maximum - minimum
    return abs(dimensions.x * dimensions.y * dimensions.z)


def matrix_error(first: Matrix, second: Matrix) -> float:
    return max(
        abs(float(first[row][column] - second[row][column]))
        for row in range(4)
        for column in range(4)
    )


def resize_and_pack_textures(
    factor: float,
    force: bool,
) -> list[dict[str, Any]]:
    if not 0.0 < factor < 1.0:
        raise ValueError("TEXTURE_SCALE должен быть между 0 и 1.")

    scene = bpy.context.scene

    if scene.get(TEXTURE_MARKER) and not force:
        print("INFO: текстуры уже уменьшались; проход пропущен.")
        return []

    report: list[dict[str, Any]] = []
    failures: list[str] = []

    for image in bpy.data.images:
        if image.name in {"Render Result", "Viewer Node"}:
            continue

        if image.source in {"MOVIE", "SEQUENCE", "TILED"}:
            print(
                f'WARNING: "{image.name}" имеет source={image.source}; '
                "пропускаем."
            )
            continue

        width = int(image.size[0])
        height = int(image.size[1])

        if width < 2 or height < 2:
            continue

        if image.get(TEXTURE_MARKER) and not force:
            continue

        new_width = max(1, round(width * factor))
        new_height = max(1, round(height * factor))

        try:
            if not image.has_data and image.source == "FILE":
                image.reload()

            image.scale(new_width, new_height)
            image.update()
            image.pack()

            image[TEXTURE_MARKER] = True
            image["powerbox_original_width"] = width
            image["powerbox_original_height"] = height

            report.append(
                {
                    "name": image.name,
                    "before": [width, height],
                    "after": [new_width, new_height],
                    "packed": image.packed_file is not None,
                }
            )

            print(
                f'TEXTURE "{image.name}": '
                f"{width}x{height} -> {new_width}x{new_height}"
            )

        except Exception as error:
            failures.append(f"{image.name}: {error}")

    if failures:
        raise RuntimeError(
            "Не удалось обработать некоторые текстуры:\n- "
            + "\n- ".join(failures)
        )

    scene[TEXTURE_MARKER] = True
    scene["powerbox_texture_scale"] = factor
    return report


def direct_geometry_objects(
    collection: bpy.types.Collection,
) -> list[bpy.types.Object]:
    return [
        obj
        for obj in collection.objects
        if obj.type in GEOMETRY_TYPES
        and not obj.name.startswith("WEB_INSTANCE_")
    ]


def detect_light_assembly(
    collection: bpy.types.Collection,
) -> dict[str, Any]:
    groups: dict[int, dict[str, bpy.types.Object]] = defaultdict(dict)

    for obj in direct_geometry_objects(collection):
        base, index = split_suffix(obj.name)

        if base in groups[index]:
            raise RuntimeError(
                f'В группе суффикса {index} два объекта с базой "{base}".'
            )

        groups[index][base] = obj

    if len(groups) < EXPECTED_LIGHT_COUNT:
        raise RuntimeError(
            f'В "{collection.name}" найдено только {len(groups)} '
            f"групп по суффиксам, ожидалось {EXPECTED_LIGHT_COUNT}."
        )

    prototype_index = 0 if 0 in groups else min(groups)

    ranked = sorted(
        groups,
        key=lambda index: (
            index != prototype_index,
            -len(groups[index]),
            index,
        ),
    )[:EXPECTED_LIGHT_COUNT]

    if prototype_index not in ranked:
        ranked[-1] = prototype_index

    ranked = sorted(set(ranked), key=lambda value: (value != prototype_index, value))

    if len(ranked) != EXPECTED_LIGHT_COUNT:
        raise RuntimeError(
            "Не удалось выбрать ровно восемь групп светильников."
        )

    common_bases = set(groups[ranked[0]])

    for index in ranked[1:]:
        common_bases.intersection_update(groups[index])

    if not common_bases:
        raise RuntimeError(
            "У светильников нет общего набора деталей по именам."
        )

    anchor_base = next(
        (
            base
            for base in common_bases
            if base.casefold() == "yoke_top_crossbar"
        ),
        None,
    )

    if anchor_base is None:
        anchor_base = max(
            common_bases,
            key=lambda base: local_bbox_volume(
                groups[prototype_index][base]
            ),
        )

    prototype_world = {
        base: groups[prototype_index][base].matrix_world.copy()
        for base in common_bases
    }

    prototype_anchor = groups[prototype_index][anchor_base].matrix_world.copy()
    inverse_anchor = prototype_anchor.inverted_safe()

    max_error = 0.0

    for index in ranked:
        instance_matrix = groups[index][anchor_base].matrix_world

        for base in common_bases:
            predicted = (
                instance_matrix
                @ inverse_anchor
                @ prototype_world[base]
            )
            actual = groups[index][base].matrix_world
            max_error = max(max_error, matrix_error(predicted, actual))

    return {
        "groups": groups,
        "indices": ranked,
        "prototypeIndex": prototype_index,
        "commonBases": sorted(common_bases),
        "anchorBase": anchor_base,
        "maxError": max_error,
    }


def create_instance_empty(
    source_collection: bpy.types.Collection,
    asset: str,
    ordinal: int,
    matrix_world: Matrix,
) -> bpy.types.Object:
    prefix = asset.upper().replace("-", "_")
    name = f"WEB_INSTANCE_{prefix}_{ordinal:02d}"

    old = bpy.data.objects.get(name)
    if old is not None:
        bpy.data.objects.remove(old, do_unlink=True)

    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 0.25
    empty.matrix_world = matrix_world
    empty.show_in_front = True

    empty["web_asset"] = asset
    empty["web_group"] = source_collection.name
    empty["web_instance_index"] = ordinal

    source_collection.objects.link(empty)
    return empty


def convert_light_assembly(
    allow_approximation: bool,
) -> tuple[dict[str, Any], list[dict[str, Any]], bpy.types.Collection]:
    source = find_collection(LIGHT_COLLECTION_NAMES)
    prototype_master = ensure_prototype_master()
    prototype_name = "__WEB_PROTO_LED_LIGHT"

    existing_prototype = bpy.data.collections.get(prototype_name)
    existing_empties = [
        obj
        for obj in source.objects
        if obj.get("web_asset") == "led-light"
    ]

    if (
        existing_prototype is not None
        and len(existing_empties) == EXPECTED_LIGHT_COUNT
    ):
        instances = [
            {
                "name": obj.name,
                "asset": "led-light",
                "group": source.name,
                "matrix": matrix_to_array(converted_matrix(obj)),
            }
            for obj in sorted(existing_empties, key=lambda item: item.name)
        ]

        return (
            {
                "collection": source.name,
                "asset": "led-light",
                "instanceCount": len(instances),
                "mode": "already-optimized",
                "prototypeCollection": existing_prototype.name,
            },
            instances,
            existing_prototype,
        )

    detection = detect_light_assembly(source)

    if detection["maxError"] > 0.02 and not allow_approximation:
        raise RuntimeError(
            "Светильники отличаются не только общей трансформацией. "
            f'Ошибка матриц: {detection["maxError"]:.6f}. '
            "Сцена не сохранена. Для принудительного продолжения "
            "запусти ALLOW_INSTANCE_APPROXIMATION=1."
        )

    groups = detection["groups"]
    indices = detection["indices"]
    prototype_index = detection["prototypeIndex"]
    common_bases = detection["commonBases"]
    anchor_base = detection["anchorBase"]

    prototype_collection = ensure_child_collection(
        prototype_master,
        prototype_name,
    )

    prototype_objects = [
        groups[prototype_index][base]
        for base in common_bases
    ]
    prototype_set = set(prototype_objects)

    original_world = {
        obj: obj.matrix_world.copy()
        for obj in prototype_objects
    }

    anchor_matrix = groups[prototype_index][anchor_base].matrix_world.copy()
    inverse_anchor = anchor_matrix.inverted_safe()

    instance_matrices = [
        groups[index][anchor_base].matrix_world.copy()
        for index in indices
    ]

    duplicates = []

    for index in indices:
        if index == prototype_index:
            continue

        duplicates.extend(
            groups[index][base]
            for base in common_bases
        )

    for obj in sorted(
        set(duplicates),
        key=lambda item: len(item.children_recursive),
        reverse=True,
    ):
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)

    for obj in prototype_objects:
        if obj.parent not in prototype_set:
            world = original_world[obj]
            obj.parent = None
            obj.matrix_world = world

    for obj in prototype_objects:
        unlink_from_all_collections(obj)
        prototype_collection.objects.link(obj)

    for obj in prototype_objects:
        if obj.parent not in prototype_set:
            obj.matrix_world = inverse_anchor @ original_world[obj]

    for base in common_bases:
        obj = groups[prototype_index][base]
        obj.name = base

    empties = [
        create_instance_empty(
            source,
            "led-light",
            ordinal,
            matrix,
        )
        for ordinal, matrix in enumerate(instance_matrices, start=1)
    ]

    instances = [
        {
            "name": obj.name,
            "asset": "led-light",
            "group": source.name,
            "matrix": matrix_to_array(converted_matrix(obj)),
        }
        for obj in empties
    ]

    return (
        {
            "collection": source.name,
            "asset": "led-light",
            "instanceCount": len(instances),
            "prototypePartCount": len(prototype_objects),
            "prototypeCollection": prototype_collection.name,
            "anchor": anchor_base,
            "maxMatrixError": detection["maxError"],
            "mode": "suffix-assembly",
        },
        instances,
        prototype_collection,
    )


def mesh_fingerprint(obj: bpy.types.Object) -> str | None:
    if obj.type != "MESH" or obj.data is None:
        return None

    mesh = obj.data
    digest = hashlib.sha256()

    digest.update(
        struct.pack(
            "<III",
            len(mesh.vertices),
            len(mesh.edges),
            len(mesh.polygons),
        )
    )

    for vertex in mesh.vertices:
        digest.update(
            struct.pack(
                "<3f",
                round(float(vertex.co.x), 6),
                round(float(vertex.co.y), 6),
                round(float(vertex.co.z), 6),
            )
        )

    for polygon in mesh.polygons:
        digest.update(
            struct.pack(
                "<II",
                len(polygon.vertices),
                int(polygon.material_index),
            )
        )

        for vertex_index in polygon.vertices:
            digest.update(struct.pack("<I", int(vertex_index)))

    materials = [
        material.name.rsplit(".", 1)[0] if material else ""
        for material in mesh.materials
    ]
    digest.update("|".join(materials).encode("utf-8"))

    return digest.hexdigest()


def detect_single_mesh_clusters() -> list[list[bpy.types.Object]]:
    # В этой сцене одинаковые экземпляры были независимо изменены,
    # поэтому их mesh fingerprints уже различаются.
    # Используем проверенный явный список объектов.

    plug_names = (
        "Object_0.001",
        "Object_0.002",
        "Object_0.003",
        "Object_0.004",
        "Object_0.005",
        "Object_0.006",
        "Object_0.007",
        "Object_0.008",
        "Object_0.009",
    )

    socket_names = (
        "Plane.015",
        "Plane.016",
        "Plane.028",
    )

    def require_meshes(
        names: tuple[str, ...],
        family_name: str,
    ) -> list[bpy.types.Object]:
        objects: list[bpy.types.Object] = []
        missing: list[str] = []
        wrong_type: list[str] = []

        for name in names:
            obj = bpy.data.objects.get(name)

            if obj is None:
                missing.append(name)
                continue

            if obj.type != "MESH":
                wrong_type.append(f"{name} ({obj.type})")
                continue

            objects.append(obj)

        if missing or wrong_type:
            messages = []

            if missing:
                messages.append(
                    "не найдены: " + ", ".join(missing)
                )

            if wrong_type:
                messages.append(
                    "не Mesh: " + ", ".join(wrong_type)
                )

            raise RuntimeError(
                f'Семейство "{family_name}" не прошло проверку: '
                + "; ".join(messages)
            )

        return objects

    plugs = require_meshes(plug_names, "plug")
    sockets = require_meshes(socket_names, "socket")

    print(
        "EXPLICIT INSTANCE FAMILY plug: "
        + ", ".join(obj.name for obj in plugs)
    )

    print(
        "EXPLICIT INSTANCE FAMILY socket: "
        + ", ".join(obj.name for obj in sockets)
    )

    return [plugs, sockets]


def convert_single_mesh_cluster(
    objects: list[bpy.types.Object],
    asset: str,
) -> tuple[dict[str, Any], list[dict[str, Any]], bpy.types.Collection]:
    prototype_master = ensure_prototype_master()
    prototype_name = f"__WEB_PROTO_{asset.upper().replace('-', '_')}"

    prototype_collection = ensure_child_collection(
        prototype_master,
        prototype_name,
    )

    prototype = objects[0]
    original_matrices = [
        obj.matrix_world.copy()
        for obj in objects
    ]
    original_collections = [
        next(
            (
                collection
                for collection in obj.users_collection
                if collection.name in {
                    existing.name
                    for existing in find_existing_collections(
                        SINGLE_MESH_COLLECTION_NAMES
                    )
                }
            ),
            obj.users_collection[0],
        )
        for obj in objects
    ]

    for duplicate in objects[1:]:
        if duplicate.name in bpy.data.objects:
            bpy.data.objects.remove(duplicate, do_unlink=True)

    prototype.parent = None
    unlink_from_all_collections(prototype)
    prototype_collection.objects.link(prototype)
    prototype.matrix_world = Matrix.Identity(4)
    prototype.name = asset

    empties = []

    for ordinal, (matrix, collection) in enumerate(
        zip(original_matrices, original_collections),
        start=1,
    ):
        empty = create_instance_empty(
            collection,
            asset,
            ordinal,
            matrix,
        )
        empties.append(empty)

    instances = [
        {
            "name": obj.name,
            "asset": asset,
            "group": obj.get("web_group"),
            "matrix": matrix_to_array(converted_matrix(obj)),
        }
        for obj in empties
    ]

    return (
        {
            "asset": asset,
            "instanceCount": len(instances),
            "prototypeCollection": prototype_collection.name,
            "prototypePartCount": 1,
            "mode": "mesh-fingerprint",
            "groups": sorted(
                {str(instance["group"]) for instance in instances}
            ),
        },
        instances,
        prototype_collection,
    )


def flatten_layer_collections(
    layer_collection: bpy.types.LayerCollection,
) -> list[bpy.types.LayerCollection]:
    result = [layer_collection]

    for child in layer_collection.children:
        result.extend(flatten_layer_collections(child))

    return result


def save_and_unhide_for_export():
    collection_state = {
        collection.name: (
            collection.hide_viewport,
            collection.hide_render,
        )
        for collection in bpy.data.collections
    }

    object_state = {}

    for obj in bpy.context.scene.objects:
        try:
            hidden = obj.hide_get()
        except RuntimeError:
            hidden = False

        object_state[obj.name] = (
            obj.hide_viewport,
            obj.hide_render,
            obj.hide_select,
            hidden,
        )

        obj.hide_viewport = False
        obj.hide_render = False
        obj.hide_select = False

        try:
            obj.hide_set(False)
        except RuntimeError:
            pass

    for collection in bpy.data.collections:
        collection.hide_viewport = False
        collection.hide_render = False

    for layer_collection in flatten_layer_collections(
        bpy.context.view_layer.layer_collection
    ):
        try:
            layer_collection.exclude = False
            layer_collection.hide_viewport = False
        except Exception:
            pass

    bpy.context.view_layer.update()
    return collection_state, object_state


def restore_visibility(collection_state, object_state) -> None:
    for name, state in collection_state.items():
        collection = bpy.data.collections.get(name)

        if collection is not None:
            collection.hide_viewport = state[0]
            collection.hide_render = state[1]

    for name, state in object_state.items():
        obj = bpy.data.objects.get(name)

        if obj is None:
            continue

        obj.hide_viewport = state[0]
        obj.hide_render = state[1]
        obj.hide_select = state[2]

        try:
            obj.hide_set(state[3])
        except RuntimeError:
            pass


def slugify(name: str, used: set[str]) -> str:
    normalized = unicodedata.normalize("NFKD", name)
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-") or "collection"

    candidate = slug
    index = 2

    while candidate in used:
        candidate = f"{slug}-{index}"
        index += 1

    used.add(candidate)
    return candidate


def export_kwargs(**kwargs) -> dict[str, Any]:
    available = {
        prop.identifier
        for prop in bpy.ops.export_scene.gltf.get_rna_type().properties
    }

    return {
        key: value
        for key, value in kwargs.items()
        if key in available
    }


def export_objects_to_glb(
    objects: list[bpy.types.Object],
    filepath: Path,
) -> dict[str, Any]:
    deselect_all()

    selectable = [
        obj
        for obj in objects
        if obj.name in bpy.context.view_layer.objects
    ]

    if not selectable:
        raise RuntimeError(f"Нет объектов для экспорта: {filepath.name}")

    for obj in selectable:
        obj.select_set(True)

    bpy.context.view_layer.objects.active = selectable[0]
    filepath.parent.mkdir(parents=True, exist_ok=True)

    result = bpy.ops.export_scene.gltf(
        **export_kwargs(
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
            export_materials="EXPORT",
            export_image_format="AUTO",
            export_cameras=False,
            export_lights=False,
            export_extras=True,
            export_animations=True,
            export_optimize_animation_size=True,
            export_skins=True,
            export_morph=True,
            export_unused_images=False,
            export_unused_textures=False,
            export_draco_mesh_compression_enable=False,
        )
    )

    deselect_all()

    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed: {filepath}")

    return {
        "objectCount": len(selectable),
        "fileSizeBytes": filepath.stat().st_size,
        "objects": sorted(obj.name for obj in selectable),
    }


def collection_parent_map() -> dict[str, str | None]:
    parents = {
        collection.name: None
        for collection in bpy.data.collections
    }

    for parent in bpy.data.collections:
        for child in parent.children:
            parents[child.name] = parent.name

    return parents


def export_light(obj: bpy.types.Object) -> dict[str, Any]:
    light = obj.data

    payload: dict[str, Any] = {
        "name": obj.name,
        "type": light.type,
        "color": [float(value) for value in light.color],
        "energy": float(light.energy),
        "matrix": matrix_to_array(converted_matrix(obj)),
        "enabled": not obj.hide_render,
        "useShadow": bool(getattr(light, "use_shadow", False)),
        "distance": float(getattr(light, "cutoff_distance", 0.0)),
    }

    if light.type == "SPOT":
        payload["spotSize"] = float(light.spot_size)
        payload["spotBlend"] = float(light.spot_blend)

    if light.type == "AREA":
        payload["shape"] = light.shape
        payload["size"] = float(light.size)
        payload["sizeY"] = float(
            getattr(light, "size_y", light.size)
        )

    return payload


def export_camera(obj: bpy.types.Object) -> dict[str, Any]:
    camera = obj.data

    return {
        "name": obj.name,
        "type": camera.type,
        "matrix": matrix_to_array(converted_matrix(obj)),
        "fovYDegrees": math.degrees(float(camera.angle_y)),
        "orthoScale": float(camera.ortho_scale),
        "near": float(camera.clip_start),
        "far": float(camera.clip_end),
        "dof": {
            "enabled": bool(camera.dof.use_dof),
            "focusObject": (
                camera.dof.focus_object.name
                if camera.dof.focus_object is not None
                else None
            ),
            "focusDistance": float(camera.dof.focus_distance),
            "fStop": float(camera.dof.aperture_fstop),
        },
    }


def export_everything(
    output_dir: Path,
    manifest_path: Path,
    texture_report: list[dict[str, Any]],
    family_report: list[dict[str, Any]],
    instances: list[dict[str, Any]],
    prototype_collections: dict[str, bpy.types.Collection],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    prototypes_dir = output_dir.parent / "prototypes"
    prototypes_dir.mkdir(parents=True, exist_ok=True)

    for old in output_dir.glob("*.glb"):
        old.unlink()

    for old in prototypes_dir.glob("*.glb"):
        old.unlink()

    parents = collection_parent_map()
    used_slugs: set[str] = set()

    collection_state, object_state = save_and_unhide_for_export()

    exported_collections: list[dict[str, Any]] = []
    exported_prototypes: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []

    instance_groups = {
        str(instance["group"])
        for instance in instances
    }

    try:
        for asset, collection in prototype_collections.items():
            filepath = prototypes_dir / f"{asset}.glb"
            objects = [
                obj
                for obj in collection.all_objects
                if obj.type in EXPORTABLE_TYPES
            ]

            details = export_objects_to_glb(objects, filepath)

            exported_prototypes.append(
                {
                    "asset": asset,
                    "file": filepath.name,
                    "fileSizeBytes": details["fileSizeBytes"],
                    "objectCount": details["objectCount"],
                }
            )

            print(
                f'PROTOTYPE "{asset}": '
                f'{details["fileSizeBytes"] / 1024 / 1024:.2f} MiB'
            )

        for collection in bpy.data.collections:
            if collection.name == PROTOTYPE_MASTER_NAME:
                continue

            if collection.name.startswith("__WEB_PROTO"):
                continue

            objects = [
                obj
                for obj in collection.objects
                if obj.type in EXPORTABLE_TYPES
                and not obj.get("web_asset")
            ]

            slug = slugify(collection.name, used_slugs)
            filepath = output_dir / f"{slug}.glb"
            file_name: str | None = None
            file_size = 0
            object_count = 0
            object_names: list[str] = []

            if objects:
                try:
                    details = export_objects_to_glb(objects, filepath)
                    file_name = filepath.name
                    file_size = details["fileSizeBytes"]
                    object_count = details["objectCount"]
                    object_names = details["objects"]

                    print(
                        f'COLLECTION "{collection.name}": '
                        f'{file_size / 1024 / 1024:.2f} MiB'
                    )

                except Exception as error:
                    failures.append(
                        {
                            "collection": collection.name,
                            "error": str(error),
                        }
                    )
                    continue

            if file_name is None and collection.name not in instance_groups:
                continue

            original_hidden = (
                collection_state.get(collection.name, (False, False))[0]
                or collection_state.get(collection.name, (False, False))[1]
            )

            exported_collections.append(
                {
                    "name": collection.name,
                    "slug": slug,
                    "file": file_name,
                    "parent": parents.get(collection.name),
                    "children": sorted(
                        child.name
                        for child in collection.children
                        if not child.name.startswith("__WEB_PROTO")
                    ),
                    "defaultVisible": not original_hidden,
                    "objectCount": object_count,
                    "objects": object_names,
                    "fileSizeBytes": file_size,
                    "instanceCount": sum(
                        1
                        for instance in instances
                        if instance["group"] == collection.name
                    ),
                }
            )

    finally:
        restore_visibility(collection_state, object_state)
        bpy.context.view_layer.update()

    scene = bpy.context.scene
    world_color = [0.02, 0.02, 0.02]

    if scene.world is not None:
        world_color = [
            float(value)
            for value in scene.world.color
        ]

    lights = [
        export_light(obj)
        for obj in scene.objects
        if obj.type == "LIGHT"
    ]

    cameras = [
        export_camera(obj)
        for obj in scene.objects
        if obj.type == "CAMERA"
    ]

    manifest = {
        "version": 3,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceBlend": Path(bpy.data.filepath).name,
        "scene": {
            "name": scene.name,
            "worldColor": world_color,
            "exposureStops": float(scene.view_settings.exposure),
            "renderEngine": str(scene.render.engine),
            "cameraMode": "orthographic",
        },
        "activeCamera": (
            scene.camera.name
            if scene.camera is not None
            else None
        ),
        "collections": exported_collections,
        "prototypes": exported_prototypes,
        "instances": instances,
        "lights": lights,
        "cameras": cameras,
        "optimization": {
            "textures": texture_report,
            "instanceFamilies": family_report,
        },
        "failures": failures,
        "summary": {
            "collectionCount": len(exported_collections),
            "prototypeCount": len(exported_prototypes),
            "instanceCount": len(instances),
            "lightCount": len(lights),
            "cameraCount": len(cameras),
            "collectionGlbBytes": sum(
                item["fileSizeBytes"]
                for item in exported_collections
            ),
            "prototypeGlbBytes": sum(
                item["fileSizeBytes"]
                for item in exported_prototypes
            ),
            "totalGlbBytes": (
                sum(
                    item["fileSizeBytes"]
                    for item in exported_collections
                )
                + sum(
                    item["fileSizeBytes"]
                    for item in exported_prototypes
                )
            ),
        },
    }

    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    if failures:
        raise RuntimeError(
            "Некоторые коллекции не экспортировались:\n- "
            + "\n- ".join(
                f'{failure["collection"]}: {failure["error"]}'
                for failure in failures
            )
        )

    print("=" * 72)
    print("POWERBOX OPTIMIZED EXPORT COMPLETE")
    print(f'Collections: {manifest["summary"]["collectionCount"]}')
    print(f'Prototypes: {manifest["summary"]["prototypeCount"]}')
    print(f'Instances: {manifest["summary"]["instanceCount"]}')
    print(
        "Total GLB: "
        f'{manifest["summary"]["totalGlbBytes"] / 1024 / 1024:.2f} MiB'
    )


def main() -> None:
    arguments = parse_arguments()

    if not bpy.data.filepath:
        raise RuntimeError("Blender-файл не имеет сохранённого пути.")

    texture_report = resize_and_pack_textures(
        arguments.texture_scale,
        arguments.force_textures,
    )

    light_report, light_instances, light_prototype = (
        convert_light_assembly(arguments.allow_approximation)
    )

    single_clusters = detect_single_mesh_clusters()

    single_reports = []
    single_instances = []
    prototype_collections = {
        "led-light": light_prototype,
    }

    asset_by_count = {
        9: "plug",
        3: "socket",
    }

    for expected_count, cluster in zip(
        EXPECTED_SINGLE_CLUSTER_COUNTS,
        single_clusters,
    ):
        asset = asset_by_count[expected_count]

        report, instances, prototype = convert_single_mesh_cluster(
            cluster,
            asset,
        )

        single_reports.append(report)
        single_instances.extend(instances)
        prototype_collections[asset] = prototype

    all_instances = light_instances + single_instances
    family_report = [light_report] + single_reports

    bpy.context.scene[INSTANCE_MARKER] = True
    bpy.context.scene["powerbox_viewer_camera_mode"] = "ORTHOGRAPHIC"

    export_everything(
        output_dir=Path(arguments.output).expanduser().resolve(),
        manifest_path=Path(arguments.manifest).expanduser().resolve(),
        texture_report=texture_report,
        family_report=family_report,
        instances=all_instances,
        prototype_collections=prototype_collections,
    )

    # Сохраняем WEB_EXPORT только после успешного экспорта и валидации.
    bpy.ops.wm.save_as_mainfile(
        filepath=bpy.data.filepath,
        check_existing=False,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
