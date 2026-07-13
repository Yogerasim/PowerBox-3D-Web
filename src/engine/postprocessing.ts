import type { Camera, Scene, WebGLRenderer } from "three";
import { EffectComposer, RenderPass } from "postprocessing";

export function createPostprocessing(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  return composer;
}
