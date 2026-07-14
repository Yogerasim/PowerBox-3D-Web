#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${POWERBOX_PROJECT_DIR:-$HOME/Documents/GitHub/PowerBox-3D-Web}"
PUSH_CHANGES="${PUSH_CHANGES:-0}"

cd "$PROJECT_DIR"

MAIN="src/viewer/main.ts"
TEMPLATE="templates/viewer_main_v3.ts"
YOKE="src/viewer/yokeLights.ts"

for FILE in "$MAIN" "$TEMPLATE" "$YOKE"; do
  [[ -f "$FILE" ]] || {
    echo "Не найден: $FILE"
    exit 1
  }
done

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".local-backups/yoke-hard-switch-v16-$STAMP"

mkdir -p "$BACKUP_DIR"

cp -p "$MAIN" "$BACKUP_DIR/main.ts"
cp -p "$TEMPLATE" "$BACKUP_DIR/viewer_main_v3.ts"
cp -p "$YOKE" "$BACKUP_DIR/yokeLights.ts"

python3 <<'PY'
from pathlib import Path
import re

paths = [
    Path("src/viewer/main.ts"),
    Path("templates/viewer_main_v3.ts"),
]

for path in paths:
    text = path.read_text(encoding="utf-8")

    text, first_count = re.subn(
        r"scene\.environmentIntensity\s*=\s*0\.8\s*;",
        "scene.environmentIntensity = 0.15;",
        text,
        count=1,
    )

    text, second_count = re.subn(
        r"environment\s*:\s*0\.8\s*,",
        "environment: 0.15,",
        text,
        count=1,
    )

    if first_count == 0 and "scene.environmentIntensity = 0.15;" not in text:
        raise RuntimeError(
            f"Не найден scene.environmentIntensity в {path}"
        )

    if second_count == 0 and "environment: 0.15," not in text:
        raise RuntimeError(
            f"Не найден settings.environment в {path}"
        )

    path.write_text(text, encoding="utf-8")
    print("Directional environment:", path)
PY

echo
echo "[Yoke V16] Проверяем жёсткое переключение..."

grep -n \
  -E \
  'hardSwitchSignal|Hard switching|dutyCycle|offLevel' \
  "$YOKE"

echo
echo "[Yoke V16] Проверяем environment..."

grep -n \
  -E \
  'environmentIntensity =|environment:' \
  "$MAIN" \
  | head -n 5

echo
echo "[Yoke V16] Production build..."

npm run build

if [[ "$PUSH_CHANGES" == "1" ]]; then
  BRANCH="$(git branch --show-current)"

  git add -- \
    src/viewer/main.ts \
    src/viewer/yokeLights.ts \
    templates/viewer_main_v3.ts \
    docs/yoke_hard_switch_v16.md \
    apply_yoke_hard_switch_v16.sh

  echo
  echo "В коммит войдёт:"
  git diff --cached --stat

  if ! git diff --cached --quiet; then
    git commit -m \
      "Use hard switching for directional Yoke lights"
  fi

  git push origin "$BRANCH"

  echo
  echo "Последний deployment:"
  sleep 3

  gh run list \
    --branch "$BRANCH" \
    --limit 1
fi

echo
echo "============================================================"
echo "POWERBOX YOKE HARD SWITCH V16 COMPLETE"
echo "============================================================"
echo
echo "Проверка:"
echo "  pkill -f vite || true"
echo "  npm run viewer:dev"
echo
echo "Backup:"
echo "  $BACKUP_DIR"
