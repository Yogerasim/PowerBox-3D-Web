# PowerBox 3D Web

Интерактивная 3D-презентация PowerBox — восьмиканального контроллера для световых и медиаинсталляций.

## Stack

- Vite
- TypeScript
- Three.js
- GSAP + ScrollTrigger
- postprocessing
- glTF / GLB
- Blender
- glTF Transform

## Blender scenes

- `blender/PowerBox_MASTER.blend` — главная авторская сцена.
- `blender/PowerBox_WEB_EXPORT.blend` — копия для web-оптимизации и GLB-экспорта.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## GLB tools

```bash
npm run model:inspect
npm run model:validate
```
