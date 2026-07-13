import {
  DirectionalLight,
  HemisphereLight,
  Scene,
} from "three";

export function addBaseLighting(scene: Scene): void {
  const ambient = new HemisphereLight(0xdde7ff, 0x18120d, 1.4);

  const key = new DirectionalLight(0xffffff, 4);
  key.position.set(4, 6, 5);

  const rim = new DirectionalLight(0xff5a1f, 1.5);
  rim.position.set(-4, 2, -3);

  scene.add(ambient, key, rim);
}
