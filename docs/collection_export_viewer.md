# PowerBox collection exporter + first web scene preview

## What is included

```text
scripts/export_collections_glb.py
run_export_collections.sh
install_collection_viewer.sh
viewer.html
src/viewer/main.ts
src/viewer/style.css
```

The exporter reads:

```text
blender/PowerBox_WEB_EXPORT.blend
```

and creates:

```text
public/assets/models/collections/*.glb
public/assets/models/collections-manifest.json
```

The Blender file is not saved or modified.

## Export logic

By default, every collection exports only its directly linked objects. Child
collections become their own GLB modules. This avoids repeating every nested
object in every parent file.

Lights and cameras are not embedded in the module GLBs. Their world-space
positions, rotations and settings are written to the JSON manifest. The web
viewer reconstructs:

- Point lights
- Sun lights as DirectionalLight
- Spot lights
- Area lights as RectAreaLight
- Active Blender camera, FOV, clipping planes and focus target

## Installation

From the repository root:

```bash
cd "$HOME/Documents/GitHub/PowerBox-3D-Web"
unzip -o "$HOME/Downloads/PowerBox_collection_export_viewer.zip"
chmod +x install_collection_viewer.sh
./install_collection_viewer.sh
```

## Export collections

Close `PowerBox_WEB_EXPORT.blend` in Blender, then run:

```bash
npm run export:collections
```

## Open the first scene preview

```bash
npm run viewer:dev
```

Vite opens:

```text
http://localhost:5173/viewer.html
```

## Viewer controls

The right-side Scene Lab panel can:

- enable or disable every collection;
- lazy-load a hidden collection the first time it is enabled;
- load and show every module;
- use the active Blender camera;
- frame currently loaded models;
- adjust exposure;
- adjust environment lighting;
- scale all imported Blender light intensities;
- enable or disable all Blender lights;
- preview dynamic shadows.

## Hidden collections

All collections are exported. Collections hidden in Blender are disabled on
the first web load, but can be enabled in the viewer.

To load everything by default:

```bash
INCLUDE_HIDDEN_BY_DEFAULT=1 npm run export:collections
```

## Recursive mode

Direct mode is recommended:

```bash
npm run export:collections
```

To include nested collection content in every parent GLB:

```bash
EXPORT_RECURSIVE=1 npm run export:collections
```

Recursive mode duplicates nested geometry and embedded textures between GLBs.

## Custom Blender location

```bash
BLENDER_BIN="/Applications/Blender.app/Contents/MacOS/Blender" \
npm run export:collections
```

## Important GLB size note

Separate files make conditional and lazy loading possible. They do not reduce
the total download when every module is loaded. Because GLB embeds textures,
the same texture may be repeated in several collection files. Later we can
move shared textures to external KTX2 assets or combine collections that use
the same material set.

## Lighting note

The preview preserves light placement, direction, color and area dimensions,
but Blender Eevee and Three.js use different render pipelines. Use the global
`Light multiplier`, `Exposure`, and `Environment` controls to establish the
first visual match. Area-light shadows are not supported by RectAreaLight, so
critical shadow-casting lights should later be represented by SpotLight or
DirectionalLight helpers.
