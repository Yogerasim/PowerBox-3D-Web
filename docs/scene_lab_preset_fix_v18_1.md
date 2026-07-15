# Scene Lab Preset Fix V18.1

Сохранённый preset содержит правильные значения, но старый DOM-export не
смог определить имена и папки lil-gui:

```json
{
  "path": [],
  "name": "unnamed"
}
```

V18.1 восстанавливает этот preset по порядку реальных контроллеров через
официальный API lil-gui:

```text
controllersRecursive()
getValue()
setValue()
```

Значения сопоставляются по типу:

```text
boolean → checkbox
number / numeric string → slider
hex string → color
```

Повторные HTML-поля одного color-controller автоматически пропускаются.

## Установка

```bash
cd "$HOME/Documents/GitHub/PowerBox-3D-Web"

unzip -o \
  "$HOME/Downloads/PowerBox_scene_preset_legacy_fix_v18_1.zip"

chmod +x \
  apply_scene_lab_preset_fix_v18_1.sh

PUSH_CHANGES=1 \
./apply_scene_lab_preset_fix_v18_1.sh
```
