#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BLEND_FILE="${POWERBOX_BLEND_FILE:-$PROJECT_DIR/blender/PowerBox_WEB_EXPORT.blend}"
EXPORTER="$PROJECT_DIR/scripts/export_collections_glb.py"

OUTPUT_DIR="$PROJECT_DIR/public/assets/models/collections"
MANIFEST="$PROJECT_DIR/public/assets/models/collections-manifest.json"


fail() {
  printf '\n[PowerBox] ERROR: %s\n' "$1" >&2
  exit 1
}


find_blender() {
  if [[ -n "${BLENDER_BIN:-}" ]]; then
    [[ -x "$BLENDER_BIN" ]] || \
      fail "BLENDER_BIN не является исполняемым файлом: $BLENDER_BIN"

    printf '%s\n' "$BLENDER_BIN"
    return
  fi

  local candidates=(
    "/Applications/Blender.app/Contents/MacOS/Blender"
    "/Applications/Blender 5.1.app/Contents/MacOS/Blender"
    "$HOME/Applications/Blender.app/Contents/MacOS/Blender"
  )

  local candidate

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  if command -v blender >/dev/null 2>&1; then
    command -v blender
    return
  fi

  fail "Blender не найден."
}


[[ -f "$BLEND_FILE" ]] || \
  fail "Blender-сцена не найдена: $BLEND_FILE"

[[ -f "$EXPORTER" ]] || \
  fail "Python-экспортёр не найден: $EXPORTER"


BLENDER="$(find_blender)"

mkdir -p "$OUTPUT_DIR"

rm -f "$OUTPUT_DIR"/*.glb
rm -f "$MANIFEST"


printf '\n[PowerBox] Blender: %s\n' "$BLENDER"
printf '[PowerBox] Source: %s\n' "$BLEND_FILE"
printf '[PowerBox] Output: %s\n\n' "$OUTPUT_DIR"


# Команда всегда содержит обязательные аргументы.
# Это устраняет ошибку EXTRA_ARGS[@]: unbound variable
# в старом системном Bash на macOS.

BLENDER_COMMAND=(
  "$BLENDER"
  --background
  "$BLEND_FILE"
  --python
  "$EXPORTER"
  --
  --output
  "$OUTPUT_DIR"
  --manifest
  "$MANIFEST"
)


if [[ "${INCLUDE_HIDDEN_BY_DEFAULT:-0}" == "1" ]]; then
  BLENDER_COMMAND+=(--include-hidden)
fi


"${BLENDER_COMMAND[@]}"


printf '\n[PowerBox] Экспортированные GLB:\n'

find "$OUTPUT_DIR" \
  -maxdepth 1 \
  -type f \
  -name '*.glb' \
  -exec ls -lh {} +


printf '\n[PowerBox] Manifest:\n'
ls -lh "$MANIFEST"


printf '\n[PowerBox] Экспорт завершён.\n'
printf 'Viewer: npm run viewer:dev\n'
printf 'URL: http://localhost:5173/viewer.html\n'
