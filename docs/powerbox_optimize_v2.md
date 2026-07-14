# PowerBox Optimize Scene V2

Пакет изменяет только:

```text
blender/PowerBox_WEB_EXPORT.blend
```

`PowerBox_MASTER.blend` не открывается и не изменяется.

## Что делает

1. Создаёт резервную копию `PowerBox_WEB_EXPORT.blend`.
2. Уменьшает ширину и высоту пригодных текстур в два раза.
3. Упаковывает уменьшенные изображения в WEB_EXPORT-файл.
4. Находит восемь светильников в `Led_Lights` по именам деталей:
   `detail`, `detail.001` … `detail.007`.
5. Использует `yoke_top_crossbar` как опорную деталь светильника.
6. Оставляет одну сборку светильника как GLB-прототип.
7. Заменяет восемь сборок на восемь Empty-маркеров.
8. Среди `Plugs`, `Details_Box`, `Socets` и `Sockets` ищет:
   - один кластер из девяти одинаковых Mesh;
   - один кластер из трёх одинаковых Mesh.
9. Оставляет по одному GLB-прототипу `plug.glb` и `socket.glb`.
10. Сохраняет Empty в исходных коллекциях.
11. Экспортирует уникальные коллекции в `collections/*.glb`.
12. Экспортирует повторяющиеся ассеты в `prototypes/*.glb`.
13. Записывает матрицы всех экземпляров в `collections-manifest.json`.
14. Обновляет текущий Scene Lab, не заменяя его CSS и `viewer.html`.
15. Переводит Scene Lab на постоянную `OrthographicCamera`.
16. Проверяет production build.
17. Делает commit, push и ожидает GitHub Pages.

## Безопасность

Если скрипт не найдёт ровно:

```text
8 светильников
9 одинаковых Mesh
3 одинаковых Mesh
```

он остановится до сохранения Blender-файла.

Если восемь светильников отличаются не только общей позицией, поворотом и
масштабом, скрипт также остановится.

Резервные копии находятся здесь:

```text
blender/backups/
.local-backups/
```

Обе папки добавляются в `.gitignore`.

## Установка

Закрой `PowerBox_WEB_EXPORT.blend` в Blender.

Распакуй ZIP в корень репозитория:

```bash
cd "$HOME/Documents/GitHub/PowerBox-3D-Web"

unzip -o \
  "$HOME/Downloads/PowerBox_optimize_scene_v2.zip"

chmod +x run_powerbox_optimize_v2.sh
```

## Запуск

```bash
./run_powerbox_optimize_v2.sh
```

## Только локальный тест, без push

```bash
PUSH_CHANGES=0 ./run_powerbox_optimize_v2.sh
```

## Не ждать GitHub Actions

```bash
WAIT_FOR_DEPLOY=0 ./run_powerbox_optimize_v2.sh
```

## Повторно уменьшить текстуры

Обычный повторный запуск не уменьшает текстуры второй раз. Принудительный режим:

```bash
FORCE_TEXTURE_RESCALE=1 ./run_powerbox_optimize_v2.sh
```

Это ещё раз уменьшит ширину и высоту уже уменьшенных изображений в два раза.

## Допустить небольшое отличие сборок светильников

По умолчанию скрипт останавливается, если относительные трансформации деталей
восьми светильников отличаются.

Принудительный режим:

```bash
ALLOW_INSTANCE_APPROXIMATION=1 \
./run_powerbox_optimize_v2.sh
```

Использовать его стоит только после проверки отчёта об ошибке.

## Результат

```text
public/assets/models/
├── collections/
├── prototypes/
│   ├── led-light.glb
│   ├── plug.glb
│   └── socket.glb
└── collections-manifest.json
```

Viewer скачивает каждый прототип один раз, а затем создаёт:

```text
8 экземпляров led-light
9 экземпляров plug
3 экземпляра socket
```

Геометрии и текстуры прототипов остаются общими между экземплярами.
