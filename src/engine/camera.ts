import { PerspectiveCamera, Vector3 } from "three";

export const cameraTarget = new Vector3(0, 0.45, 0);

export function createCamera(aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(35, aspect, 0.01, 150);
  camera.position.set(3, 1.8, 5.5);
  camera.lookAt(cameraTarget);
  return camera;
}
