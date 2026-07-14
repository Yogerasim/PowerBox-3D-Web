#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${POWERBOX_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
BLEND_FILE="${POWERBOX_BLEND_FILE:-$PROJECT_DIR/blender/PowerBox_WEB_EXPORT.blend}"

TARGET_BRANCH="${POWERBOX_BRANCH:-feature/scene-lab-preview-v1}"
REPO="${POWERBOX_REPO:-Yogerasim/PowerBox-3D-Web}"

TEXTURE_SCALE="${TEXTURE_SCALE:-0.5}"
FORCE_TEXTURE_RESCALE="${FORCE_TEXTURE_RESCALE:-0}"
ALLOW_INSTANCE_APPROXIMATION="${ALLOW_INSTANCE_APPROXIMATION:-0}"

PUSH_CHANGES="${PUSH_CHANGES:-1}"
WAIT_FOR_DEPLOY="${WAIT_FOR_DEPLOY:-1}"

BLENDER_SCRIPT="$PROJECT_DIR/scripts/powerbox_optimize_export_v2.py"
VIEWER_MAIN_TEMPLATE="$PROJECT_DIR/templates/viewer_main_v3.ts"
VIEWER_TYPES_TEMPLATE="$PROJECT_DIR/templates/viewer_types_v3.ts"

COLLECTIONS_DIR="$PROJECT_DIR/public/assets/models/collections"
PROTOTYPES_DIR="$PROJECT_DIR/public/assets/models/prototypes"
MANIFEST_FILE="$PROJECT_DIR/public/assets/models/collections-manifest.json"

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
BLEND_BACKUP_DIR="$PROJECT_DIR/blender/backups"
SOURCE_BACKUP_DIR="$PROJECT_DIR/.local-backups/$TIMESTAMP"

log() {
  printf '\n[PowerBox Optimize V2] %s\n' "$1"
}

fail() {
  printf '\n[PowerBox Optimize V2] ERROR: %s\n' "$1" >&2
  exit 1
}

find_blender() {
  if [[ -n "${BLENDER_BIN:-}" ]]; then
    [[ -x "$BLENDER_BIN" ]] || fail "BLENDER_BIN не исполняемый: $BLENDER_BIN"
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

  fail "Blender не найден. Укажи BLENDER_BIN вручную."
}

for command in git node npm python3; do
  command -v "$command" >/dev/null 2>&1 \
    || fail "Не установлена команда: $command"
done

[[ -d "$PROJECT_DIR/.git" ]] \
  || fail "Git-репозиторий не найден: $PROJECT_DIR"

[[ -f "$PROJECT_DIR/package.json" ]] \
  || fail "package.json не найден."

[[ -f "$BLEND_FILE" ]] \
  || fail "WEB_EXPORT сцена не найдена: $BLEND_FILE"

[[ -f "$BLENDER_SCRIPT" ]] \
  || fail "Blender-скрипт не найден: $BLENDER_SCRIPT"

[[ -f "$VIEWER_MAIN_TEMPLATE" ]] \
  || fail "Viewer template не найден: $VIEWER_MAIN_TEMPLATE"

[[ -f "$VIEWER_TYPES_TEMPLATE" ]] \
  || fail "Viewer types template не найден: $VIEWER_TYPES_TEMPLATE"

BLENDER="$(find_blender)"

cd "$PROJECT_DIR"

CURRENT_BRANCH="$(git branch --show-current)"

if [[ "$CURRENT_BRANCH" != "$TARGET_BRANCH" ]]; then
  fail "Сейчас активна ветка '$CURRENT_BRANCH', ожидалась '$TARGET_BRANCH'. Переключись на нужную ветку и запусти снова."
fi

mkdir -p \
  "$BLEND_BACKUP_DIR" \
  "$SOURCE_BACKUP_DIR" \
  "$COLLECTIONS_DIR" \
  "$PROTOTYPES_DIR"

if ! grep -qxF "blender/backups/" "$PROJECT_DIR/.gitignore"; then
  {
    printf '\n# Local Blender backups\n'
    printf 'blender/backups/\n'
  } >> "$PROJECT_DIR/.gitignore"
fi

if ! grep -qxF ".local-backups/" "$PROJECT_DIR/.gitignore"; then
  {
    printf '\n# Local source backups\n'
    printf '.local-backups/\n'
  } >> "$PROJECT_DIR/.gitignore"
fi

log "Создаём резервные копии"

BLEND_BACKUP="$BLEND_BACKUP_DIR/PowerBox_WEB_EXPORT_before_optimize_v2_$TIMESTAMP.blend"
cp -p "$BLEND_FILE" "$BLEND_BACKUP"

for file in \
  "$PROJECT_DIR/src/viewer/main.ts" \
  "$PROJECT_DIR/src/viewer/types.ts" \
  "$MANIFEST_FILE"
do
  if [[ -f "$file" ]]; then
    cp -p "$file" "$SOURCE_BACKUP_DIR/"
  fi
done

if [[ -d "$COLLECTIONS_DIR" ]]; then
  mkdir -p "$SOURCE_BACKUP_DIR/collections"
  find "$COLLECTIONS_DIR" \
    -maxdepth 1 \
    -type f \
    -name '*.glb' \
    -exec cp -p {} "$SOURCE_BACKUP_DIR/collections/" \;
fi

if [[ -d "$PROTOTYPES_DIR" ]]; then
  mkdir -p "$SOURCE_BACKUP_DIR/prototypes"
  find "$PROTOTYPES_DIR" \
    -maxdepth 1 \
    -type f \
    -name '*.glb' \
    -exec cp -p {} "$SOURCE_BACKUP_DIR/prototypes/" \;
fi

log "Запускаем Blender-оптимизацию"

BLENDER_COMMAND=(
  "$BLENDER"
  --background
  "$BLEND_FILE"
  --python
  "$BLENDER_SCRIPT"
  --
  --output
  "$COLLECTIONS_DIR"
  --manifest
  "$MANIFEST_FILE"
  --texture-scale
  "$TEXTURE_SCALE"
)

if [[ "$FORCE_TEXTURE_RESCALE" == "1" ]]; then
  BLENDER_COMMAND+=(--force-textures)
fi

if [[ "$ALLOW_INSTANCE_APPROXIMATION" == "1" ]]; then
  BLENDER_COMMAND+=(--allow-approximation)
fi

"${BLENDER_COMMAND[@]}"

# Blender обязан создать новый manifest V3 до изменения viewer.
[[ -f "$MANIFEST_FILE" ]] ||   fail "Blender не создал manifest: $MANIFEST_FILE"

node - "$MANIFEST_FILE" <<'NODE'
const fs = require("fs");

const path = process.argv[2];
const manifest = JSON.parse(
  fs.readFileSync(path, "utf8"),
);

if (manifest.version < 3) {
  throw new Error(
    `Ожидался manifest V3, получена версия ${manifest.version}`,
  );
}

if (!Array.isArray(manifest.instances)) {
  throw new Error(
    "В новом manifest отсутствует массив instances.",
  );
}

if (!Array.isArray(manifest.prototypes)) {
  throw new Error(
    "В новом manifest отсутствует массив prototypes.",
  );
}
NODE

log "Обновляем только runtime Scene Lab; CSS и viewer.html не меняются"

cp -p \
  "$VIEWER_MAIN_TEMPLATE" \
  "$PROJECT_DIR/src/viewer/main.ts"

cp -p \
  "$VIEWER_TYPES_TEMPLATE" \
  "$PROJECT_DIR/src/viewer/types.ts"

log "Добавляем воспроизводимую npm-команду"

node - "$PROJECT_DIR/package.json" <<'NODE'
const fs = require("fs");

const path = process.argv[2];
const packageJson = JSON.parse(
  fs.readFileSync(path, "utf8"),
);

packageJson.scripts ??= {};

packageJson.scripts["scene:optimize-v2"] =
  "./run_powerbox_optimize_v2.sh";

fs.writeFileSync(
  path,
  JSON.stringify(packageJson, null, 2) + "\n",
);
NODE

log "Проверяем manifest и ожидаемые instance counts"

node - "$MANIFEST_FILE" <<'NODE'
const fs = require("fs");

const path = process.argv[2];
const manifest = JSON.parse(
  fs.readFileSync(path, "utf8"),
);

const expected = new Map([
  ["led-light", 8],
  ["plug", 9],
  ["socket", 3],
]);

for (const [asset, count] of expected) {
  const actual = manifest.instances.filter(
    (instance) => instance.asset === asset,
  ).length;

  if (actual !== count) {
    throw new Error(
      `${asset}: expected ${count} instances, got ${actual}`,
    );
  }
}

console.log(
  `Collections: ${manifest.summary.collectionCount}`,
);

console.log(
  `Prototypes: ${manifest.summary.prototypeCount}`,
);

console.log(
  `Instances: ${manifest.summary.instanceCount}`,
);

console.log(
  `Total GLB: ${(manifest.summary.totalGlbBytes / 1024 / 1024).toFixed(2)} MiB`,
);

console.log(
  `Textures resized this run: ${manifest.optimization.textures.length}`,
);
NODE

log "Размеры GLB после оптимизации"

printf '\nCollections:\n'
find "$COLLECTIONS_DIR" \
  -maxdepth 1 \
  -type f \
  -name '*.glb' \
  -exec ls -lhS {} +

printf '\nPrototypes:\n'
find "$PROTOTYPES_DIR" \
  -maxdepth 1 \
  -type f \
  -name '*.glb' \
  -exec ls -lhS {} +

log "Проверяем production build"

npm run build

test -f "$PROJECT_DIR/dist/index.html" \
  || fail "dist/index.html не создан."

test -f "$PROJECT_DIR/dist/viewer.html" \
  || fail "dist/viewer.html не создан."

test -f "$PROJECT_DIR/dist/assets/models/collections-manifest.json" \
  || fail "Manifest не попал в dist."

test -d "$PROJECT_DIR/dist/assets/models/prototypes" \
  || fail "Prototype GLB не попали в dist."

log "Готовим commit"

git add \
  .gitignore \
  package.json \
  run_powerbox_optimize_v2.sh \
  scripts/powerbox_optimize_export_v2.py \
  templates/viewer_main_v3.ts \
  templates/viewer_types_v3.ts \
  docs/powerbox_optimize_v2.md \
  src/viewer/main.ts \
  src/viewer/types.ts \
  public/assets/models/collections \
  public/assets/models/prototypes \
  public/assets/models/collections-manifest.json \
  blender/PowerBox_WEB_EXPORT.blend

if git diff --cached --quiet; then
  log "Изменений для commit нет."
else
  git commit -m \
    "Optimize textures and repeated PowerBox scene assets"
fi

if [[ "$PUSH_CHANGES" == "1" ]]; then
  log "Push в origin/$CURRENT_BRANCH"

  git push -u origin "$CURRENT_BRANCH"

  if [[ "$WAIT_FOR_DEPLOY" == "1" ]]     && command -v gh >/dev/null 2>&1
  then
    SHA="$(git rev-parse HEAD)"
    RUN_ID=""

    log "Ищем GitHub Actions run для $SHA"

    for attempt in $(seq 1 30); do
      RUN_ID="$(
        gh run list \
          --repo "$REPO" \
          --branch "$CURRENT_BRANCH" \
          --limit 30 \
          --json databaseId,headSha,status,conclusion,name \
          --jq \
            "[.[] | select(.headSha == \"$SHA\")][0].databaseId // empty"
      )"

      if [[ -n "$RUN_ID" ]]; then
        break
      fi

      sleep 4
    done

    if [[ -n "$RUN_ID" ]]; then
      log "Ожидаем GitHub Actions run $RUN_ID"

      if gh run watch \
        "$RUN_ID" \
        --repo "$REPO" \
        --exit-status
      then
        log "GitHub Pages обновлён."
      else
        printf '\n[PowerBox Optimize V2] Deployment завершился с ошибкой.\n'
        printf 'Actions: https://github.com/%s/actions/runs/%s\n' \
          "$REPO" \
          "$RUN_ID"
      fi
    else
      printf '\n[PowerBox Optimize V2] Actions run пока не найден.\n'
    fi
  fi
fi

REVISION="$(git rev-parse --short HEAD)"

printf '\n============================================================\n'
printf 'POWERBOX OPTIMIZATION V2 COMPLETE\n'
printf '============================================================\n'
printf '\nЛокальный Scene Lab:\n'
printf '  cd "%s"\n' "$PROJECT_DIR"
printf '  npm run viewer:dev\n'
printf '\nУдалённый Scene Lab:\n'
printf '  https://yogerasim.github.io/PowerBox-3D-Web/viewer.html?rev=%s\n' \
  "$REVISION"
printf '\nBlender backup:\n'
printf '  %s\n' "$BLEND_BACKUP"
printf '\n'
