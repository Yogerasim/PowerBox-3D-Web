#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${POWERBOX_PROJECT_DIR:-$HOME/Documents/GitHub/PowerBox-3D-Web}"
PUSH_CHANGES="${PUSH_CHANGES:-1}"

cd "$PROJECT_DIR"

SOURCE="patches/sceneLabPreset.v18_1.ts"
TARGET="src/viewer/sceneLabPreset.ts"
PRESET="public/config/scene-lab-preset.json"

for FILE in "$SOURCE" "$TARGET" "$PRESET"; do
  [[ -f "$FILE" ]] || {
    echo "Не найден: $FILE"
    exit 1
  }
done

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".local-backups/preset-v18-1-$STAMP"

mkdir -p "$BACKUP_DIR"
cp -p "$TARGET" "$BACKUP_DIR/sceneLabPreset.ts"
cp -p "$PRESET" "$BACKUP_DIR/scene-lab-preset.json"

cp -p "$SOURCE" "$TARGET"

echo
echo "[Preset V18.1] Проверяем сохранённый JSON..."

python3 <<'PY'
import json
from pathlib import Path

path = Path("public/config/scene-lab-preset.json")
data = json.loads(path.read_text(encoding="utf-8"))
items = data.get("controllers", [])

if not items:
    raise SystemExit("Preset пустой.")

unnamed = sum(
    item.get("name") == "unnamed"
    and item.get("path") == []
    for item in items
)

print(f"Настроек: {len(items)}")
print(f"Legacy unnamed: {unnamed}")
PY

echo
echo "[Preset V18.1] Production build..."

npm run build

if [[ "$PUSH_CHANGES" == "1" ]]; then
  BRANCH="$(git branch --show-current)"

  git add -- \
    src/viewer/sceneLabPreset.ts \
    patches/sceneLabPreset.v18_1.ts \
    apply_scene_lab_preset_fix_v18_1.sh \
    docs/scene_lab_preset_fix_v18_1.md

  echo
  echo "В коммит войдёт:"
  git diff --cached --stat

  if ! git diff --cached --quiet; then
    git commit -m \
      "Fix restoration of saved Scene Lab settings"
  fi

  git push origin "$BRANCH"
fi

echo
echo "============================================================"
echo "POWERBOX SCENE LAB PRESET FIX V18.1 COMPLETE"
echo "============================================================"
echo
echo "Запуск:"
echo "  pkill -f vite || true"
echo "  npm run viewer:dev"
echo
echo "Backup:"
echo "  $BACKUP_DIR"
