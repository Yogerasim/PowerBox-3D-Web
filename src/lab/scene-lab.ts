import GUI from "lil-gui";
import type { PerspectiveCamera, WebGLRenderer } from "three";

interface SceneLabOptions {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
}

export function initializeSceneLab({
  renderer,
  camera,
}: SceneLabOptions): GUI {
  const gui = new GUI({ title: "PowerBox Scene Lab" });

  const cameraFolder = gui.addFolder("Camera");
  cameraFolder.add(camera.position, "x", -20, 20, 0.01);
  cameraFolder.add(camera.position, "y", -20, 20, 0.01);
  cameraFolder.add(camera.position, "z", -20, 20, 0.01);
  cameraFolder.add(camera, "fov", 15, 90, 0.1).onChange(() => {
    camera.updateProjectionMatrix();
  });

  const renderFolder = gui.addFolder("Renderer");
  renderFolder.add(renderer, "toneMappingExposure", 0.1, 3, 0.01);

  console.info("[PowerBox] Scene Lab initialized.");
  return gui;
}
