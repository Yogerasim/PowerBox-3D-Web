# PowerBox wire preparation

This utility processes:

- collection `Wire`
- collection `Wire 2`
- objects in nested collections

For each Curve or Mesh object it:

1. Creates a timestamped backup of `PowerBox_WEB_EXPORT.blend`.
2. Makes shared object data single-user where necessary.
3. Converts Blender Curve objects to Mesh.
4. Applies a Decimate modifier in `COLLAPSE` mode.
5. Uses ratio `0.5` by default.
6. Saves `blender/PowerBox_WEB_EXPORT.blend`.

## Install into the repository

From Terminal:

```bash
cd "$HOME/Documents/GitHub/PowerBox-3D-Web"
unzip -o "$HOME/Downloads/PowerBox_wire_tools.zip"
chmod +x run_prepare_powerbox_wires.sh
```

## Run

Close `PowerBox_WEB_EXPORT.blend` in Blender first, then:

```bash
cd "$HOME/Documents/GitHub/PowerBox-3D-Web"
./run_prepare_powerbox_wires.sh
```

## Different Decimate ratio

```bash
DECIMATE_RATIO=0.35 ./run_prepare_powerbox_wires.sh
```

## Override Blender executable

```bash
BLENDER_BIN="/Applications/Blender.app/Contents/MacOS/Blender" \
./run_prepare_powerbox_wires.sh
```

## Backup

Backups are written to:

```text
blender/backups/
```

That directory is added to `.gitignore`.

## Rollback

Replace the changed file with the latest backup:

```bash
cp \
  "blender/backups/PowerBox_WEB_EXPORT_before_wires_YYYYMMDD-HHMMSS.blend" \
  "blender/PowerBox_WEB_EXPORT.blend"
```

## Important

The master scene is not modified:

```text
blender/PowerBox_MASTER.blend
```

Only the web-export copy is processed.
