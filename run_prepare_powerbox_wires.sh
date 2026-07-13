#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLEND_FILE="${POWERBOX_BLEND_FILE:-$PROJECT_DIR/blender/PowerBox_WEB_EXPORT.blend}"
PYTHON_SCRIPT="$PROJECT_DIR/scripts/prepare_powerbox_wires.py"
DECIMATE_RATIO="${DECIMATE_RATIO:-0.5}"

log() {
  printf '\n[PowerBox] %s\n' "$1"
}

fail() {
  printf '\n[PowerBox] ERROR: %s\n' "$1" >&2
  exit 1
}

find_blender() {
  if [[ -n "${BLENDER_BIN:-}" ]]; then
    [[ -x "$BLENDER_BIN" ]] || fail "BLENDER_BIN is not executable: $BLENDER_BIN"
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

  fail "Blender executable was not found. Set BLENDER_BIN manually."
}

[[ -f "$BLEND_FILE" ]] || fail "Blend file not found: $BLEND_FILE"
[[ -f "$PYTHON_SCRIPT" ]] || fail "Python script not found: $PYTHON_SCRIPT"

BLENDER="$(find_blender)"

BACKUP_DIR="$PROJECT_DIR/blender/backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BACKUP_FILE="$BACKUP_DIR/PowerBox_WEB_EXPORT_before_wires_$TIMESTAMP.blend"

log "Project: $PROJECT_DIR"
log "Blender: $BLENDER"
log "Scene: $BLEND_FILE"
log "Decimate ratio: $DECIMATE_RATIO"

log "Creating backup"
cp -p "$BLEND_FILE" "$BACKUP_FILE"
printf '[PowerBox] Backup: %s\n' "$BACKUP_FILE"

GITIGNORE="$PROJECT_DIR/.gitignore"
if [[ -f "$GITIGNORE" ]] && ! grep -qxF "blender/backups/" "$GITIGNORE"; then
  {
    printf '\n# Local Blender processing backups\n'
    printf 'blender/backups/\n'
  } >> "$GITIGNORE"
fi

log "Converting Wire and Wire 2 curves to meshes and applying Decimate"

"$BLENDER" \
  --background "$BLEND_FILE" \
  --python "$PYTHON_SCRIPT" \
  -- \
  --ratio "$DECIMATE_RATIO" \
  --collections "Wire" "Wire 2"

log "Completed"
ls -lh "$BLEND_FILE" "$BACKUP_FILE"

printf '\nNext check the result in Blender:\n'
printf '  open "%s"\n' "$BLEND_FILE"
printf '\nTo use another ratio later:\n'
printf '  DECIMATE_RATIO=0.35 ./run_prepare_powerbox_wires.sh\n'
