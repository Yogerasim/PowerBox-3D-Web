# PowerBox Yoke Web Lights V15.1

V15.1 исправляет установщик V15. Старый установщик ожидал конкретное
форматирование render-функции. Новый установщик поддерживает переносы строк.

Также исправлена передача readonly-кортежей в методы Three.js.

## Установка

```bash
cd "$HOME/Documents/GitHub/PowerBox-3D-Web"

unzip -o   "$HOME/Downloads/PowerBox_yoke_web_lights_v15_1.zip"

chmod +x apply_yoke_web_lights_v15_1.sh

PUSH_CHANGES=0 ./apply_yoke_web_lights_v15_1.sh
```

После успешного build:

```bash
pkill -f vite || true
npm run viewer:dev
```

После проверки:

```bash
PUSH_CHANGES=1 ./apply_yoke_web_lights_v15_1.sh
```
