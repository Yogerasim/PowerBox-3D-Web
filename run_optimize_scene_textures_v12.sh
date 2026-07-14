#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${POWERBOX_PROJECT_DIR:-$HOME/Documents/GitHub/PowerBox-3D-Web}"
BLEND_FILE="$PROJECT_DIR/blender/PowerBox_WEB_EXPORT.blend"

SCRIPT="$PROJECT_DIR/scripts/optimize_scene_textures_v12.py"
MANIFEST="$PROJECT_DIR/public/assets/models/collections-manifest.json"
COLLECTIONS_DIR="$PROJECT_DIR/public/assets/models/collections"

BACKUP_DIR="$PROJECT_DIR/blender/backups"
STAMP="$(date '+%Y%m%d-%H%M%S')"

BLENDER="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
PUSH_CHANGES="${PUSH_CHANGES:-0}"

fail() {
  printf '\n[PowerBox Scene V12] ERROR: %s\n' "$1" >&2
  exit 1
}

cd "$PROJECT_DIR"

[[ -x "$BLENDER" ]] || fail "Blender не найден."
[[ -f "$BLEND_FILE" ]] || fail "WEB_EXPORT blend не найден."
[[ -f "$SCRIPT" ]] || fail "optimize_scene_textures_v12.py не найден."
[[ -f "$MANIFEST" ]] || fail "collections-manifest.json не найден."

mkdir -p "$BACKUP_DIR"

BACKUP_FILE="$BACKUP_DIR/PowerBox_WEB_EXPORT_before_scene_v12_$STAMP.blend"

cp -p \
  "$BLEND_FILE" \
  "$BACKUP_FILE"

BEFORE_BYTES="$(
  node - "$MANIFEST" <<'NODE'
const fs = require("fs");

const manifest = JSON.parse(
  fs.readFileSync(process.argv[2], "utf8"),
);

const entry = manifest.collections.find(
  (item) => item.name === "scene",
);

if (!entry) {
  throw new Error("scene entry not found");
}

process.stdout.write(String(entry.fileSizeBytes));
NODE
)"

echo
echo "[PowerBox Scene V12] Backup:"
echo "  $BACKUP_FILE"
echo
echo "[PowerBox Scene V12] До оптимизации:"
python3 - "$BEFORE_BYTES" <<'PY'
import sys

value = int(sys.argv[1])
print(f"  scene.glb = {value / 1024 / 1024:.2f} MiB")
PY

"$BLENDER" \
  --background \
  "$BLEND_FILE" \
  --python \
  "$SCRIPT" \
  -- \
  --manifest "$MANIFEST" \
  --collections-dir "$COLLECTIONS_DIR"

AFTER_BYTES="$(
  node - "$MANIFEST" <<'NODE'
const fs = require("fs");

const manifest = JSON.parse(
  fs.readFileSync(process.argv[2], "utf8"),
);

const entry = manifest.collections.find(
  (item) => item.name === "scene",
);

if (!entry) {
  throw new Error("scene entry not found");
}

process.stdout.write(String(entry.fileSizeBytes));
NODE
)"

echo
echo "[PowerBox Scene V12] Результат:"

python3 - "$BEFORE_BYTES" "$AFTER_BYTES" <<'PY'
import sys

before = int(sys.argv[1])
after = int(sys.argv[2])
saved = before - after
percent = (saved / before * 100) if before else 0

print(f"  до:       {before / 1024 / 1024:.2f} MiB")
print(f"  после:    {after / 1024 / 1024:.2f} MiB")
print(f"  экономия: {saved / 1024 / 1024:.2f} MiB ({percent:.1f}%)")
PY

echo
echo "[PowerBox Scene V12] Production build..."

npm run build

test -f dist/viewer.html || fail "dist/viewer.html не создан."
test -f dist/assets/models/collections-manifest.json \
  || fail "Manifest не попал в dist."

if [[ "$PUSH_CHANGES" == "1" ]]; then
  git add \
    run_optimize_scene_textures_v12.sh \
    scripts/optimize_scene_textures_v12.py \
    docs/optimize_scene_textures_v12.md \
    blender/PowerBox_WEB_EXPORT.blend \
    public/assets/models/collections/scene.glb \
    public/assets/models/collections-manifest.json

  if ! git diff --cached --quiet; then
    git commit -m \
      "Optimize non-floor scene textures"
  fi

  git push origin "$(git branch --show-current)"
fi

echo
echo "============================================================"
echo "POWERBOX SCENE TEXTURE OPTIMIZATION V12 COMPLETE"
echo "============================================================"
echo
echo "Floor texture не изменялась."
echo
echo "Перезапуск viewer:"
echo "  pkill -f vite || true"
echo "  npm run viewer:dev"
