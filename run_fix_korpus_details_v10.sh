#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${POWERBOX_PROJECT_DIR:-$HOME/Documents/GitHub/PowerBox-3D-Web}"
BLEND_FILE="$PROJECT_DIR/blender/PowerBox_WEB_EXPORT.blend"

SOURCE_BLEND="$PROJECT_DIR/blender/backups/PowerBox_WEB_EXPORT_before_wires_20260713-230442.blend"

SCRIPT="$PROJECT_DIR/scripts/fix_korpus_details_v10.py"
MANIFEST="$PROJECT_DIR/public/assets/models/collections-manifest.json"
COLLECTIONS_DIR="$PROJECT_DIR/public/assets/models/collections"

BACKUP_DIR="$PROJECT_DIR/blender/backups"
STAMP="$(date '+%Y%m%d-%H%M%S')"

BLENDER="${BLENDER_BIN:-/Applications/Blender.app/Contents/MacOS/Blender}"
PUSH_CHANGES="${PUSH_CHANGES:-0}"

fail() {
  printf '\n[PowerBox V10] ERROR: %s\n' "$1" >&2
  exit 1
}

cd "$PROJECT_DIR"

[[ -x "$BLENDER" ]] || fail "Blender не найден."
[[ -f "$BLEND_FILE" ]] || fail "WEB_EXPORT blend не найден."
[[ -f "$SOURCE_BLEND" ]] || fail "Качественный backup New_korpus не найден."
[[ -f "$SCRIPT" ]] || fail "fix_korpus_details_v10.py не найден."
[[ -f "$MANIFEST" ]] || fail "collections-manifest.json не найден."

mkdir -p "$BACKUP_DIR"

CURRENT_BACKUP="$BACKUP_DIR/PowerBox_WEB_EXPORT_before_fix_v10_$STAMP.blend"

cp -p \
  "$BLEND_FILE" \
  "$CURRENT_BACKUP"

echo
echo "[PowerBox V10] Источник качественного New_korpus:"
echo "  $SOURCE_BLEND"
echo
echo "[PowerBox V10] Текущий backup:"
echo "  $CURRENT_BACKUP"

"$BLENDER" \
  --background \
  "$BLEND_FILE" \
  --python \
  "$SCRIPT" \
  -- \
  --source "$SOURCE_BLEND" \
  --manifest "$MANIFEST" \
  --collections-dir "$COLLECTIONS_DIR"

echo
echo "[PowerBox V10] Размеры новых GLB:"

node - "$MANIFEST" <<'NODE'
const fs = require("fs");

const manifest = JSON.parse(
  fs.readFileSync(process.argv[2], "utf8"),
);

for (const name of ["New_korpus", "Details_Box"]) {
  const entry = manifest.collections.find(
    (item) => item.name === name,
  );

  if (!entry) {
    throw new Error(`Manifest entry not found: ${name}`);
  }

  console.log(
    `${name}: ${(entry.fileSizeBytes / 1024 / 1024).toFixed(2)} MiB`,
  );
}
NODE

echo
echo "[PowerBox V10] Production build..."

npm run build

test -f dist/viewer.html || fail "dist/viewer.html не создан."
test -f dist/assets/models/collections-manifest.json \
  || fail "Manifest не попал в dist."

if [[ "$PUSH_CHANGES" == "1" ]]; then
  git add \
    run_fix_korpus_details_v10.sh \
    scripts/fix_korpus_details_v10.py \
    docs/fix_korpus_details_v10.md \
    blender/PowerBox_WEB_EXPORT.blend \
    public/assets/models/collections \
    public/assets/models/collections-manifest.json

  if ! git diff --cached --quiet; then
    git commit -m \
      "Restore quality corpus and optimize detail textures"
  fi

  git push
fi

echo
echo "============================================================"
echo "POWERBOX KORPUS + DETAILS FIX V10 COMPLETE"
echo "============================================================"
echo
echo "Floor и scene не изменялись."
echo "Object_0.002 сохранён текущим Decimate-вариантом."
echo
echo "Перезапуск viewer:"
echo "  pkill -f vite || true"
echo "  npm run viewer:dev"
