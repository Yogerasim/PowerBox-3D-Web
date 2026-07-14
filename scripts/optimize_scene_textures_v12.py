from __future__ import annotations

import argparse
import json
import re
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import bpy


TARGET_SIZES = {
    "wdvlbdds_2K_Normal.jpg": 1024,
    "wdvlbdds_2K_Albedo.jpg": 1024,
    "sanserviera_decimated_baseColor.jpg": 2048,
    "Folding_Table_baseColor.jpg": 1024,
    "Folding_Table_normal.jpg": 1024,
    "Folding_Table_metallicRoughness_metal.jpg": 1024,
    "Folding_Table_metallicRoughness_rough.jpg": 1024,
}

FLOOR_IMAGE_PREFIX = "vlpqdf1_2K_Albedo"

EXPORTABLE_TYPES = {
    "MESH",
    "CURVE",
    "SURFACE",
    "FONT",
    "META",
    "ARMATURE",
    "EMPTY",
}


def parse_arguments() -> argparse.Namespace:
    argv = sys.argv
    script_args = argv[argv.index("--") + 1:] if "--" in argv else []

    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--collections-dir", required=True)
    return parser.parse_args(script_args)


def normalize(value: str) -> str:
    return re.sub(
        r"[^a-zа-я0-9]+",
        "",
        value.casefold(),
    )


def find_collection(name: str) -> bpy.types.Collection:
    wanted = normalize(name)

    for collection in bpy.data.collections:
        if normalize(collection.name) == wanted:
            return collection

    raise RuntimeError(f'Не найдена коллекция "{name}".')


def scene_materials(
    collection: bpy.types.Collection,
) -> set[bpy.types.Material]:
    materials = set()

    for obj in collection.all_objects:
        if obj.type != "MESH":
            continue

        for material in obj.data.materials:
            if material is not None:
                materials.add(material)

    return materials


def material_users() -> dict[bpy.types.Material, set[bpy.types.Object]]:
    result: dict[bpy.types.Material, set[bpy.types.Object]] = {}

    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue

        for material in obj.data.materials:
            if material is None:
                continue

            result.setdefault(material, set()).add(obj)

    return result


def target_image_nodes(
    materials: set[bpy.types.Material],
) -> dict[str, list[tuple[bpy.types.Material, bpy.types.Node]]]:
    result: dict[
        str,
        list[tuple[bpy.types.Material, bpy.types.Node]],
    ] = {}

    for material in materials:
        if material.node_tree is None:
            continue

        for node in material.node_tree.nodes:
            if node.type != "TEX_IMAGE" or node.image is None:
                continue

            image_name = node.image.name

            if image_name.startswith(FLOOR_IMAGE_PREFIX):
                continue

            if image_name not in TARGET_SIZES:
                continue

            result.setdefault(image_name, []).append(
                (material, node)
            )

    return result


def ensure_targets_are_scene_only(
    collection: bpy.types.Collection,
    nodes_by_image: dict[
        str,
        list[tuple[bpy.types.Material, bpy.types.Node]],
    ],
) -> None:
    scene_objects = set(collection.all_objects)
    users = material_users()

    violations = []

    for image_name, pairs in nodes_by_image.items():
        for material, _node in pairs:
            outside = sorted(
                obj.name
                for obj in users.get(material, set())
                if obj not in scene_objects
            )

            if outside:
                violations.append(
                    {
                        "image": image_name,
                        "material": material.name,
                        "outsideObjects": outside,
                    }
                )

    if violations:
        raise RuntimeError(
            "Оптимизация остановлена: некоторые материалы scene "
            "используются объектами вне scene:\n"
            + json.dumps(
                violations,
                ensure_ascii=False,
                indent=2,
            )
        )


def resize_target_images(
    nodes_by_image: dict[
        str,
        list[tuple[bpy.types.Material, bpy.types.Node]],
    ],
) -> list[dict[str, Any]]:
    missing = sorted(
        set(TARGET_SIZES) - set(nodes_by_image)
    )

    if missing:
        raise RuntimeError(
            "В collection scene не найдены ожидаемые изображения: "
            + ", ".join(missing)
        )

    report = []

    for image_name, target_max in TARGET_SIZES.items():
        image = nodes_by_image[image_name][0][1].image

        if image is None:
            raise RuntimeError(
                f'Image node "{image_name}" не содержит изображения.'
            )

        width = int(image.size[0])
        height = int(image.size[1])

        if width <= target_max and height <= target_max:
            report.append(
                {
                    "name": image.name,
                    "before": [width, height],
                    "after": [width, height],
                    "changed": False,
                    "targetMax": target_max,
                    "packedBytes": (
                        int(image.packed_file.size)
                        if image.packed_file is not None
                        else 0
                    ),
                }
            )
            continue

        scale = min(
            target_max / width,
            target_max / height,
        )

        new_width = max(1, round(width * scale))
        new_height = max(1, round(height * scale))

        if not image.has_data and image.source == "FILE":
            image.reload()

        image.scale(new_width, new_height)
        image.update()
        image.pack()

        report.append(
            {
                "name": image.name,
                "before": [width, height],
                "after": [new_width, new_height],
                "changed": True,
                "targetMax": target_max,
                "packedBytes": (
                    int(image.packed_file.size)
                    if image.packed_file is not None
                    else 0
                ),
            }
        )

    return report


def flatten_layer_collections(
    layer_collection: bpy.types.LayerCollection,
) -> list[bpy.types.LayerCollection]:
    result = [layer_collection]

    for child in layer_collection.children:
        result.extend(flatten_layer_collections(child))

    return result


def save_and_unhide():
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


def exporter_kwargs(**kwargs) -> dict[str, Any]:
    available = {
        prop.identifier
        for prop in bpy.ops.export_scene.gltf.get_rna_type().properties
    }

    return {
        key: value
        for key, value in kwargs.items()
        if key in available
    }


def export_collection(
    collection: bpy.types.Collection,
    filepath: Path,
) -> dict[str, Any]:
    objects = [
        obj
        for obj in collection.objects
        if obj.type in EXPORTABLE_TYPES
        and not obj.get("web_asset")
        and obj.name in bpy.context.view_layer.objects
    ]

    if not objects:
        raise RuntimeError(
            f'В коллекции "{collection.name}" нет объектов для экспорта.'
        )

    for obj in list(bpy.context.selected_objects):
        obj.select_set(False)

    for obj in objects:
        obj.select_set(True)

    bpy.context.view_layer.objects.active = objects[0]
    filepath.parent.mkdir(parents=True, exist_ok=True)

    result = bpy.ops.export_scene.gltf(
        **exporter_kwargs(
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

    for obj in list(bpy.context.selected_objects):
        obj.select_set(False)

    if "FINISHED" not in result:
        raise RuntimeError(
            f'Не удалось экспортировать "{collection.name}".'
        )

    return {
        "fileSizeBytes": filepath.stat().st_size,
        "objectCount": len(objects),
        "objects": sorted(obj.name for obj in objects),
    }


def manifest_entry(
    manifest: dict[str, Any],
    collection_name: str,
) -> dict[str, Any]:
    wanted = normalize(collection_name)

    for entry in manifest.get("collections", []):
        if normalize(str(entry.get("name", ""))) == wanted:
            return entry

    raise RuntimeError(
        f'В manifest не найдена коллекция "{collection_name}".'
    )


def update_summary(
    manifest: dict[str, Any],
    collections_dir: Path,
) -> None:
    collection_bytes = 0

    for entry in manifest.get("collections", []):
        filename = entry.get("file")

        if filename:
            filepath = collections_dir / filename

            if filepath.exists():
                entry["fileSizeBytes"] = filepath.stat().st_size

        collection_bytes += int(entry.get("fileSizeBytes", 0))

    prototypes_dir = collections_dir.parent / "prototypes"
    prototype_bytes = 0

    for entry in manifest.get("prototypes", []):
        filename = entry.get("file")

        if filename:
            filepath = prototypes_dir / filename

            if filepath.exists():
                entry["fileSizeBytes"] = filepath.stat().st_size

        prototype_bytes += int(entry.get("fileSizeBytes", 0))

    summary = manifest.setdefault("summary", {})
    summary["collectionGlbBytes"] = collection_bytes
    summary["prototypeGlbBytes"] = prototype_bytes
    summary["totalGlbBytes"] = collection_bytes + prototype_bytes

    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()


def main() -> None:
    arguments = parse_arguments()

    manifest_path = Path(arguments.manifest).expanduser().resolve()
    collections_dir = Path(
        arguments.collections_dir
    ).expanduser().resolve()

    if not manifest_path.exists():
        raise RuntimeError(
            f"Manifest не найден: {manifest_path}"
        )

    manifest = json.loads(
        manifest_path.read_text(encoding="utf-8")
    )

    collection = find_collection("scene")
    materials = scene_materials(collection)
    nodes_by_image = target_image_nodes(materials)

    ensure_targets_are_scene_only(
        collection,
        nodes_by_image,
    )

    floor_images = sorted(
        {
            node.image.name
            for material in materials
            if material.node_tree is not None
            for node in material.node_tree.nodes
            if node.type == "TEX_IMAGE"
            and node.image is not None
            and node.image.name.startswith(FLOOR_IMAGE_PREFIX)
        }
    )

    if not floor_images:
        raise RuntimeError(
            "Floor texture не найдена; оптимизация остановлена."
        )

    texture_report = resize_target_images(
        nodes_by_image
    )

    collection_state, object_state = save_and_unhide()

    try:
        entry = manifest_entry(
            manifest,
            collection.name,
        )

        filename = entry.get("file")

        if not filename:
            raise RuntimeError(
                'У collection "scene" отсутствует file в manifest.'
            )

        export_report = export_collection(
            collection,
            collections_dir / filename,
        )

        entry.update(export_report)

    finally:
        restore_visibility(
            collection_state,
            object_state,
        )

    update_summary(
        manifest,
        collections_dir,
    )

    manifest_path.write_text(
        json.dumps(
            manifest,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    bpy.ops.wm.save_as_mainfile(
        filepath=bpy.data.filepath,
        check_existing=False,
    )

    print("=" * 72)
    print("POWERBOX SCENE TEXTURE OPTIMIZATION V12 COMPLETE")
    print(
        json.dumps(
            {
                "floorImagesUntouched": floor_images,
                "optimizedTextures": texture_report,
                "sceneExport": export_report,
                "summary": manifest.get("summary", {}),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        raise SystemExit(1)
