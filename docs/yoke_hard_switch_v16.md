# PowerBox Yoke Hard Switch V16

## Изменение переключения

В V15 яркость вычислялась непрерывно, поэтому свет плавно затухал и
нарастал. V16 выдаёт только два состояния:

```text
ON  = полная текущая яркость
OFF = Off level, по умолчанию 0
```

Переход между ними происходит за один кадр без интерполяции.

## Настройки Hard switching

- Enabled;
- Speed Hz;
- On duration;
- Random timing;
- Phase spread;
- Off level.

При `Phase spread = 0` восемь источников переключаются синхронно. При `1`
используются индивидуальные фазы. `Random timing` смешивает периодический
сигнал с нерегулярным, но результат всё равно остаётся жёстким ON/OFF.

## Направленность

Источники остаются `RectAreaLight`. Этот свет односторонний и направлен
вдоль локальной оси `-Z`, как в полученных трансформациях Blender.

Впечатление всестороннего света создавало окружение RoomEnvironment с
интенсивностью `0.8`. V16 снижает начальное значение до `0.15`, поэтому
основной вклад дают восемь Area Lights. Значение всё ещё регулируется:

```text
Scene → Environment
```

Для чистой проверки направления установи `Environment = 0`.

## Установка

```bash
cd "$HOME/Documents/GitHub/PowerBox-3D-Web"

unzip -o   "$HOME/Downloads/PowerBox_yoke_hard_switch_v16.zip"

chmod +x apply_yoke_hard_switch_v16.sh

PUSH_CHANGES=0 ./apply_yoke_hard_switch_v16.sh

pkill -f vite || true
npm run viewer:dev
```

После проверки:

```bash
PUSH_CHANGES=1 ./apply_yoke_hard_switch_v16.sh
```
