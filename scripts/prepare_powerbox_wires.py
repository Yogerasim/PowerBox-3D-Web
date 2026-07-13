#!/usr/bin/env python3
"""
PowerBox WEB_EXPORT wire preparation.

Processes every CURVE/MESH object in the named collections:
1. Converts curves to meshes.
2. Makes mesh data single-user when necessary.
3. Applies a Decimate modifier with the requested ratio.
4. Saves the currently opened .blend file.

Designed for Blender background mode.
"""

from __future__ import annotations

import argparse
import sys
import traceback
from dataclasses import dataclass

import bpy


@dataclass
class ObjectReport:
    name: str
    source_type: str
    vertices_before: int
    vertices_after: int
    polygons_before: int
    polygons_after: int


def parse_arguments() -> argparse.Namespace:
    argv = sys.argv
    script_argv = argv[argv.index("--") + 1 :] if "--" in argv else []

    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--ratio",
        type=float,
        default=0.5,
        help="Decimate COLLAPSE ratio in the range (0, 1].",
    )
    parser.add_argument(
        "--collections",
        nargs="+",
        default=["Wire", "Wire 2"],
        help="Collection names to process, including nested objects.",
    )
    return parser.parse_args(script_argv)


def validate_ratio(value: float) -> float:
    if not 0.0 < value <= 1.0:
        raise ValueError(f"Decimate ratio must be > 0 and <= 1, got {value}.")
    return value


def switch_to_object_mode() -> None:
    active = bpy.context.view_layer.objects.active
    if active is not None and active.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def deselect_all() -> None:
    for selected in list(bpy.context.selected_objects):
        selected.select_set(False)


def activate_object(obj: bpy.types.Object) -> None:
    deselect_all()
    obj.hide_viewport = False
    obj.hide_select = False
    try:
        obj.hide_set(False)
    except RuntimeError:
        pass
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def collect_targets(
    collection_names: list[str],
) -> tuple[list[bpy.types.Object], list[str]]:
    targets: list[bpy.types.Object] = []
    missing: list[str] = []
    seen: set[int] = set()

    for collection_name in collection_names:
        collection = bpy.data.collections.get(collection_name)
        if collection is None:
            missing.append(collection_name)
            continue

        for obj in collection.all_objects:
            pointer = obj.as_pointer()
            if pointer not in seen:
                seen.add(pointer)
                targets.append(obj)

    return targets, missing


def make_temp_collection() -> bpy.types.Collection:
    name = "__POWERBOX_WIRE_PROCESSING__"
    old = bpy.data.collections.get(name)
    if old is not None:
        bpy.data.collections.remove(old)

    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def process_object(
    obj: bpy.types.Object,
    ratio: float,
    temp_collection: bpy.types.Collection,
) -> ObjectReport | None:
    if obj.library is not None:
        print(f'WARNING: skipping linked-library object "{obj.name}".')
        return None

    if obj.type not in {"CURVE", "MESH"}:
        print(f'INFO: skipping non-wire type {obj.type}: "{obj.name}".')
        return None

    original_name = obj.name
    source_type = obj.type

    original_hide_viewport = obj.hide_viewport
    original_hide_render = obj.hide_render
    original_hide_select = obj.hide_select
    try:
        original_hidden = obj.hide_get()
    except RuntimeError:
        original_hidden = False

    was_in_temp_collection = temp_collection in list(obj.users_collection)

    if not was_in_temp_collection:
        temp_collection.objects.link(obj)

    try:
        # Prevent changes from propagating to linked duplicate object data.
        if obj.data is not None and obj.data.users > 1:
            obj.data = obj.data.copy()

        activate_object(obj)

        if obj.type == "CURVE":
            result = bpy.ops.object.convert(
                target="MESH",
                keep_original=False,
            )
            if "FINISHED" not in result:
                raise RuntimeError(
                    f'Curve conversion failed for "{original_name}": {result}'
                )

            # The active object remains the converted object.
            obj = bpy.context.view_layer.objects.active
            if obj is None or obj.type != "MESH":
                raise RuntimeError(
                    f'Converted object "{original_name}" is not an active mesh.'
                )

        mesh = obj.data
        if mesh is None or len(mesh.polygons) == 0:
            print(f'WARNING: mesh "{obj.name}" has no polygons; skipping decimate.')
            return ObjectReport(
                name=obj.name,
                source_type=source_type,
                vertices_before=len(mesh.vertices) if mesh else 0,
                vertices_after=len(mesh.vertices) if mesh else 0,
                polygons_before=0,
                polygons_after=0,
            )

        vertices_before = len(mesh.vertices)
        polygons_before = len(mesh.polygons)

        modifier_name = "__POWERBOX_WEB_DECIMATE__"
        old_modifier = obj.modifiers.get(modifier_name)
        if old_modifier is not None:
            obj.modifiers.remove(old_modifier)

        modifier = obj.modifiers.new(
            name=modifier_name,
            type="DECIMATE",
        )
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = False

        activate_object(obj)
        result = bpy.ops.object.modifier_apply(modifier=modifier.name)
        if "FINISHED" not in result:
            raise RuntimeError(
                f'Decimate apply failed for "{obj.name}": {result}'
            )

        obj.data.update()

        return ObjectReport(
            name=obj.name,
            source_type=source_type,
            vertices_before=vertices_before,
            vertices_after=len(obj.data.vertices),
            polygons_before=polygons_before,
            polygons_after=len(obj.data.polygons),
        )

    finally:
        # Restore scene visibility settings.
        if obj is not None and obj.name in bpy.data.objects:
            obj.hide_viewport = original_hide_viewport
            obj.hide_render = original_hide_render
            obj.hide_select = original_hide_select
            try:
                obj.hide_set(original_hidden)
            except RuntimeError:
                pass

            if (
                not was_in_temp_collection
                and temp_collection in list(obj.users_collection)
            ):
                temp_collection.objects.unlink(obj)


def main() -> None:
    arguments = parse_arguments()
    ratio = validate_ratio(arguments.ratio)

    if not bpy.data.filepath:
        raise RuntimeError("The Blender file has no saved filepath.")

    switch_to_object_mode()

    targets, missing_collections = collect_targets(arguments.collections)

    print("=" * 72)
    print("POWERBOX WIRE WEB PREPARATION")
    print(f"Blend file: {bpy.data.filepath}")
    print(f"Collections: {', '.join(arguments.collections)}")
    print(f"Decimate ratio: {ratio}")
    print(f"Objects found: {len(targets)}")
    print("=" * 72)

    if missing_collections:
        print(
            "WARNING: collections not found: "
            + ", ".join(f'"{name}"' for name in missing_collections)
        )

    if not targets:
        raise RuntimeError(
            "No objects found in the requested collections. "
            "The file was not changed."
        )

    temp_collection = make_temp_collection()
    reports: list[ObjectReport] = []
    failures: list[tuple[str, str]] = []

    try:
        for index, obj in enumerate(targets, start=1):
            print(f'[{index}/{len(targets)}] Processing "{obj.name}" ({obj.type})')
            try:
                report = process_object(obj, ratio, temp_collection)
                if report is not None:
                    reports.append(report)
            except Exception as error:
                failures.append((obj.name, str(error)))
                print(f'ERROR: "{obj.name}": {error}')
                traceback.print_exc()
    finally:
        if temp_collection.name in bpy.data.collections:
            bpy.data.collections.remove(temp_collection)

    bpy.context.view_layer.update()

    if failures:
        print("\nThe file will NOT be saved because some objects failed:")
        for object_name, message in failures:
            print(f"- {object_name}: {message}")
        raise RuntimeError(
            f"{len(failures)} object(s) failed. Restore from the backup if needed."
        )

    bpy.ops.wm.save_as_mainfile(
        filepath=bpy.data.filepath,
        check_existing=False,
    )

    total_vertices_before = sum(item.vertices_before for item in reports)
    total_vertices_after = sum(item.vertices_after for item in reports)
    total_polygons_before = sum(item.polygons_before for item in reports)
    total_polygons_after = sum(item.polygons_after for item in reports)

    print("\n" + "=" * 72)
    print("POWERBOX WIRES PREPARED AND FILE SAVED")
    print("=" * 72)

    for report in reports:
        print(
            f'{report.name}: {report.source_type} -> MESH | '
            f'vertices {report.vertices_before} -> {report.vertices_after} | '
            f'polygons {report.polygons_before} -> {report.polygons_after}'
        )

    print("-" * 72)
    print(f"Processed objects: {len(reports)}")
    print(f"Vertices: {total_vertices_before} -> {total_vertices_after}")
    print(f"Polygons: {total_polygons_before} -> {total_polygons_after}")
    print(f"Saved: {bpy.data.filepath}")


if __name__ == "__main__":
    main()
