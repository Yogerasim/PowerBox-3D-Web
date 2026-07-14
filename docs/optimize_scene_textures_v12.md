# PowerBox Scene Texture Optimization V12

Диагностика показала:

- `scene.glb`: 16.62 MiB;
- изображения: 16.35 MiB — 98.4%;
- геометрия: только 0.26 MiB.

Поэтому геометрию `scene` сейчас трогать не нужно.

V12 оставляет текстуру пола без изменений:

```text
vlpqdf1_2K_Albedo — 2048×2048
```

Уменьшаются только остальные карты:

```text
wdvlbdds_2K_Normal                 2048 → 1024
wdvlbdds_2K_Albedo                 2048 → 1024
sanserviera_decimated_baseColor    4096 → 2048
Folding_Table_baseColor            2048 → 1024
Folding_Table_normal               2048 → 1024
Folding_Table_metallic             2048 → 1024
Folding_Table_rough                2048 → 1024
```

Ожидаемый размер `scene.glb` — примерно 7–10 MiB. Точный размер зависит
от повторного JPEG/PNG-кодирования Blender.

## Безопасный запуск

Закрой `PowerBox_WEB_EXPORT.blend`.

```bash
cd "$HOME/Documents/GitHub/PowerBox-3D-Web"

unzip -o \
  "$HOME/Downloads/PowerBox_optimize_scene_textures_v12.zip"

chmod +x run_optimize_scene_textures_v12.sh

PUSH_CHANGES=0 ./run_optimize_scene_textures_v12.sh
```

После успешной строки:

```text
POWERBOX SCENE TEXTURE OPTIMIZATION V12 COMPLETE
```

перезапусти viewer:

```bash
pkill -f vite || true
npm run viewer:dev
```

После визуальной проверки:

```bash
PUSH_CHANGES=1 ./run_optimize_scene_textures_v12.sh
```
