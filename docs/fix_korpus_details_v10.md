# PowerBox Korpus + Details Fix V10

Диагностика показала:

```text
Качественный New_korpus:
blender/backups/PowerBox_WEB_EXPORT_before_wires_20260713-230442.blend
15371 faces

Текущий New_korpus:
14154 faces

Текущий Object_0.002:
1101 faces

Details_Box:
три текстуры 2048x2048
```

V10:

1. Восстанавливает `New_korpus` только из `before_wires`.
2. Проверяет, что восстановленный корпус действительно содержит больше полигонов.
3. Оставляет текущий `Object_0.002` после ручного Decimate.
4. Уменьшает только три текстуры `Details_Box` до 1024×1024:
   - `library-parts-baked-1_baseColor.png.008`
   - `library-parts-baked-1_baseColor.png.009`
   - `library-parts-baked-1_normal.jpg.004`
5. Не изменяет Floor и collection `scene`.
6. Переэкспортирует только `New_korpus` и `Details_Box`.

## Безопасный запуск

Закрой `PowerBox_WEB_EXPORT.blend`.

```bash
cd "$HOME/Documents/GitHub/PowerBox-3D-Web"

unzip -o \
  "$HOME/Downloads/PowerBox_fix_korpus_details_v10.zip"

chmod +x run_fix_korpus_details_v10.sh

PUSH_CHANGES=0 ./run_fix_korpus_details_v10.sh
```

После строки:

```text
POWERBOX KORPUS + DETAILS FIX V10 COMPLETE
```

перезапусти viewer:

```bash
pkill -f vite || true
npm run viewer:dev
```

После визуальной проверки:

```bash
PUSH_CHANGES=1 ./run_fix_korpus_details_v10.sh
```
