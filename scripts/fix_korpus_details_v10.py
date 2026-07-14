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


EXPORTABLE_TYPES = {
    "MESH",
    "CURVE",
    "SURFACE",
    "FONT",
    "META",
    "ARMATURE",
    "EMPTY",
}

DETAILS_TEXTURE_MAX_SIZE = 1024

DETAILS_TEXTURE_NAMES = {
    "library-parts-baked-1_baseColor.png.008",
    "library-parts-baked-1_baseColor.png.009",
    "library-parts-baked-1_normal.jpg.004",
}


def parse_arguments() -> argparse.Namespace:
    argv = sys.argv
    script_args = argv[argv.index("--") + 1:] if "--" in argv else []

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
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


def find_library_collection_name(
    names: list[str],
    target: str,
) -> str:
    wanted = normalize(target)

    for name in names:
        if normalize(name) == wanted:
            return name

    raise RuntimeError(
        f'В исходном blend не найдена коллекция "{target}".'
    )


def collection_parents(
    target: bpy.types.Collection,
) -> list[bpy.types.Collection]:
    parents = []

    for collection in bpy.data.collections:
        if target.name in collection.children:
            parents.append(collection)

    return parents


def collection_tree(
    root: bpy.types.Collection,
) -> list[bpy.types.Collection]:
    result = [root]

    for child in root.children:
        result.extend(collection_tree(child))

    return result


def remove_collection_tree(
    root: bpy.types.Collection,
) -> None:
    tree = collection_tree(root)
    tree_set = set(tree)

    objects = {
        obj
        for collection in tree
        for obj in collection.objects
    }

    for obj in objects:
        external_users = [
            collection
            for collection in obj.users_collection
            if collection not in tree_set
        ]

        if external_users:
            for collection in list(obj.users_collection):
                if collection in tree_set:
                    collection.objects.unlink(obj)
        else:
            bpy.data.objects.remove(obj, do_unlink=True)

    for collection in reversed(tree):
        if collection.name in bpy.data.collections:
            bpy.data.collections.remove(collection)


def collection_face_count(
    collection: bpy.types.Collection,
) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0

    for obj in collection.all_objects:
        if obj.type != "MESH":
            continue

        evaluated = obj.evaluated_get(depsgraph)
        mesh = None

        try:
            mesh = evaluated.to_mesh()
            total += len(mesh.polygons)
        finally:
            if mesh is not None:
                evaluated.to_mesh_clear()

    return total


def restore_new_korpus(
    source_blend: Path,
) -> dict[str, Any]:
    current = find_collection("New_korpus")
    before_faces = collection_face_count(current)

    parent_names = [
        parent.name
        for parent in collection_parents(current)
    ]

    root_was_parent = (
        current.name in bpy.context.scene.collection.children
    )

    remove_collection_tree(current)

    with bpy.data.libraries.load(
        str(source_blend),
        link=False,
    ) as (data_from, data_to):
        source_name = find_library_collection_name(
            list(data_from.collections),
            "New_korpus",
        )
        data_to.collections = [source_name]

    restored = data_to.collections[0]

    if restored is None:
        raise RuntimeError(
            "New_korpus не загрузился из исходного blend."
        )

    linked = False

    for parent_name in parent_names:
        parent = bpy.data.collections.get(parent_name)

        if parent is None:
            continue

        if restored.name not in parent.children:
            parent.children.link(restored)

        linked = True

    if root_was_parent or not linked:
        root = bpy.context.scene.collection

        if restored.name not in root.children:
            root.children.link(restored)

    after_faces = collection_face_count(restored)

    if after_faces <= before_faces:
        raise RuntimeError(
            "Восстановленный New_korpus не качественнее текущего: "
            f"{before_faces} -> {after_faces} faces."
        )

    return {
        "collection": restored.name,
        "beforeFaces": before_faces,
        "afterFaces": after_faces,
        "sourceBlend": str(source_blend),
        "objects": sorted(
            obj.name for obj in restored.all_objects
        ),
    }


def details_images(
    collection: bpy.types.Collection,
) -> list[bpy.types.Image]:
    images: dict[int, bpy.types.Image] = {}

    for obj in collection.all_objects:
        if obj.type != "MESH":
            continue

        for material in obj.data.materials:
            if material is None or material.node_tree is None:
                continue

            for node in material.node_tree.nodes:
                if node.type != "TEX_IMAGE" or node.image is None:
                    continue

                image = node.image

                if image.name not in DETAILS_TEXTURE_NAMES:
                    continue

                images[image.as_pointer()] = image

    return list(images.values())


def resize_details_textures(
    collection: bpy.types.Collection,
) -> list[dict[str, Any]]:
    images = details_images(collection)

    found_names = {
        image.name
        for image in images
    }

    missing = sorted(
        DETAILS_TEXTURE_NAMES - found_names
    )

    if missing:
        raise RuntimeError(
            "В Details_Box не найдены ожидаемые текстуры: "
            + ", ".join(missing)
        )

    report = []

    for image in images:
        width = int(image.size[0])
        height = int(image.size[1])

        if width <= DETAILS_TEXTURE_MAX_SIZE and height <= DETAILS_TEXTURE_MAX_SIZE:
            report.append(
                {
                    "name": image.name,
                    "before": [width, height],
                    "after": [width, height],
                    "changed": False,
                }
            )
            continue

        scale = min(
            DETAILS_TEXTURE_MAX_SIZE / width,
            DETAILS_TEXTURE_MAX_SIZE / height,
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
                "packedBytes": (
                    int(image.packed_file.size)
                    if image.packed_file is not None
                    else 0
                ),
            }
        )

    return sorted(
        report,
        key=lambda item: item["name"].casefold(),
    )


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
        "objectCount": len(objects),
        "objects": sorted(obj.name for obj in objects),
        "fileSizeBytes": filepath.stat().st_size,
        "evaluatedFaces": collection_face_count(collection),
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

    source_blend = Path(arguments.source).expanduser().resolve()
    manifest_path = Path(arguments.manifest).expanduser().resolve()
    collections_dir = Path(
        arguments.collections_dir
    ).expanduser().resolve()

    if not source_blend.exists():
        raise RuntimeError(
            f"Исходный blend не найден: {source_blend}"
        )

    if not manifest_path.exists():
        raise RuntimeError(
            f"Manifest не найден: {manifest_path}"
        )

    manifest = json.loads(
        manifest_path.read_text(encoding="utf-8")
    )

    object_002 = bpy.data.objects.get("Object_0.002")

    if object_002 is None or object_002.type != "MESH":
        raise RuntimeError(
            "Текущий Object_0.002 не найден либо не является Mesh."
        )

    object_002_faces = len(
        object_002.evaluated_get(
            bpy.context.evaluated_depsgraph_get()
        ).to_mesh().polygons
    )

    if object_002_faces != 1101:
        print(
            "WARNING: Object_0.002 содержит "
            f"{object_002_faces} faces, ожидалось 1101."
        )

    korpus_report = restore_new_korpus(source_blend)

    details_collection = find_collection("Details_Box")
    texture_report = resize_details_textures(
        details_collection
    )

    collection_state, object_state = save_and_unhide()
    export_report: dict[str, Any] = {}

    try:
        for collection_name in (
            "New_korpus",
            "Details_Box",
        ):
            collection = find_collection(collection_name)
            entry = manifest_entry(
                manifest,
                collection.name,
            )

            filename = entry.get("file")

            if not filename:
                raise RuntimeError(
                    f'У "{collection.name}" отсутствует file в manifest.'
                )

            report = export_collection(
                collection,
                collections_dir / filename,
            )

            entry.update(report)
            export_report[collection.name] = report

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
    print("POWERBOX KORPUS + DETAILS FIX V10 COMPLETE")
    print(
        json.dumps(
            {
                "newKorpus": korpus_report,
                "object002Faces": object_002_faces,
                "detailsTextures": texture_report,
                "exports": export_report,
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
