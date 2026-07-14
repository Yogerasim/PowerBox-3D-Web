#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${POWERBOX_PROJECT_DIR:-$HOME/Documents/GitHub/PowerBox-3D-Web}"
PUSH_CHANGES="${PUSH_CHANGES:-0}"

cd "$PROJECT_DIR"

MAIN="src/viewer/main.ts"
TEMPLATE="templates/viewer_main_v3.ts"

[[ -f "$MAIN" ]] || {
  echo "Не найден: $MAIN"
  exit 1
}

[[ -f "$TEMPLATE" ]] || {
  echo "Не найден: $TEMPLATE"
  exit 1
}

[[ -f "src/viewer/yokeLightConfig.ts" ]] || {
  echo "Не найден: src/viewer/yokeLightConfig.ts"
  exit 1
}

[[ -f "src/viewer/yokeLights.ts" ]] || {
  echo "Не найден: src/viewer/yokeLights.ts"
  exit 1
}

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".local-backups/yoke-web-lights-v15-1-$STAMP"

mkdir -p "$BACKUP_DIR"

cp -p "$MAIN" "$BACKUP_DIR/main.ts"
cp -p "$TEMPLATE" "$BACKUP_DIR/viewer_main_v3.ts"

python3 <<'PY'
from __future__ import annotations

import re
from pathlib import Path


paths = [
    Path("src/viewer/main.ts"),
    Path("templates/viewer_main_v3.ts"),
]

module_import = (
    'import { createYokeLightRig } '
    'from "./yokeLights";'
)

root_block = '''const yokeLightRig = createYokeLightRig();
scene.add(yokeLightRig.root);'''

gui_line = "yokeLightRig.addGUI(gui);"

update_line = (
    "yokeLightRig.update(performance.now() * 0.001);"
)


def insert_import(text: str, path: Path) -> str:
    if module_import in text:
        return text

    skeleton_pattern = re.compile(
        r'(^\s*import\s+\{\s*clone\s+as\s+cloneObject\s*\}'
        r'\s+from\s+"three/addons/utils/SkeletonUtils\.js";)',
        re.MULTILINE,
    )

    if skeleton_pattern.search(text):
        return skeleton_pattern.sub(
            module_import + r"\n\1",
            text,
            count=1,
        )

    type_import_pattern = re.compile(
        r'(^\s*import\s+type\s+\{)',
        re.MULTILINE,
    )

    if type_import_pattern.search(text):
        return type_import_pattern.sub(
            module_import + r"\n\1",
            text,
            count=1,
        )

    raise RuntimeError(
        f"Не найдено место для import в {path}"
    )


def insert_root(text: str, path: Path) -> str:
    if root_block in text:
        return text

    pattern = re.compile(
        r'(scene\.add\(\s*modelRoot\s*,\s*lightRoot\s*\);)'
    )

    if not pattern.search(text):
        raise RuntimeError(
            f"Не найден scene.add(modelRoot, lightRoot) в {path}"
        )

    return pattern.sub(
        r"\1\n\n" + root_block,
        text,
        count=1,
    )


def insert_gui(text: str, path: Path) -> str:
    if gui_line in text:
        return text

    pattern = re.compile(
        r'(^[ \t]*)const\s+cameraActions\s*=\s*\{',
        re.MULTILINE,
    )

    match = pattern.search(text)

    if not match:
        raise RuntimeError(
            f"Не найден cameraActions в {path}"
        )

    indentation = match.group(1)

    replacement = (
        f"{indentation}{gui_line}\n\n"
        f"{indentation}const cameraActions = {{"
    )

    return pattern.sub(
        replacement,
        text,
        count=1,
    )


def insert_render_update(text: str, path: Path) -> str:
    if update_line in text:
        return text

    pattern = re.compile(
        r'(controls\.update\(\);)'
        r'(\s*)'
        r'(renderer\.render\(\s*scene\s*,\s*camera\s*\);)'
    )

    matches = list(pattern.finditer(text))

    if len(matches) != 1:
        raise RuntimeError(
            f"Ожидался один render-блок в {path}, "
            f"найдено: {len(matches)}"
        )

    match = matches[0]
    whitespace = match.group(2)

    if "\n" in whitespace:
        indentation = whitespace.rsplit("\n", 1)[-1]
        insertion = (
            match.group(1)
            + "\n"
            + indentation
            + update_line
            + whitespace
            + match.group(3)
        )
    else:
        insertion = (
            match.group(1)
            + " "
            + update_line
            + " "
            + match.group(3)
        )

    return (
        text[:match.start()]
        + insertion
        + text[match.end():]
    )


for path in paths:
    text = path.read_text(encoding="utf-8")

    text = insert_import(text, path)
    text = insert_root(text, path)
    text = insert_gui(text, path)
    text = insert_render_update(text, path)

    required = [
        module_import,
        root_block,
        gui_line,
        update_line,
    ]

    missing = [
        value
        for value in required
        if value not in text
    ]

    if missing:
        raise RuntimeError(
            f"После патча в {path} отсутствуют: {missing}"
        )

    path.write_text(text, encoding="utf-8")
    print("Исправлен:", path)
PY

echo
echo "[Yoke V15.1] Проверяем интеграцию..."

grep -n \
  -E \
  'createYokeLightRig|yokeLightRig.addGUI|yokeLightRig.update' \
  "$MAIN"

echo
echo "[Yoke V15.1] Production build..."

npm run build

if [[ "$PUSH_CHANGES" == "1" ]]; then
  BRANCH="$(git branch --show-current)"

  git add -- \
    src/viewer/main.ts \
    src/viewer/yokeLightConfig.ts \
    src/viewer/yokeLights.ts \
    templates/viewer_main_v3.ts \
    docs/yoke_web_lights_v15_1.md \
    apply_yoke_web_lights_v15_1.sh

  echo
  echo "В коммит войдёт:"
  git diff --cached --stat

  if ! git diff --cached --quiet; then
    git commit -m \
      "Add Blender-matched Yoke area lights and flicker controls"
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
echo "POWERBOX YOKE WEB LIGHTS V15.1 COMPLETE"
echo "============================================================"
echo
echo "Локальная проверка:"
echo "  pkill -f vite || true"
echo "  npm run viewer:dev"
echo
echo "Backup:"
echo "  $BACKUP_DIR"
