import "./style.css";

import {
  BoxGeometry,
  Clock,
  Mesh,
  MeshStandardMaterial,
} from "three";

import { createRenderer } from "./engine/renderer";
import { createScene } from "./engine/scene";
import { createCamera } from "./engine/camera";
import { addBaseLighting } from "./engine/lighting";
import { createPostprocessing } from "./engine/postprocessing";
import { initializeScrollStory } from "./website/scroll-story";
import { storySections } from "./website/sections";
import { initializeSceneLab } from "./lab/scene-lab";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Element #app was not found.");
}

app.innerHTML = `
  <main id="story">
    ${storySections
      .map(
        (section) => `
          <section id="${section.id}" class="story-section">
            <div class="story-section__content">
              <p class="eyebrow">${section.eyebrow}</p>
              <h1>${section.title}</h1>
              <p class="description">${section.body}</p>
            </div>
          </section>
        `,
      )
      .join("")}
  </main>
`;

const renderer = createRenderer();
renderer.domElement.className = "webgl-canvas";
document.body.prepend(renderer.domElement);

const scene = createScene();
const camera = createCamera(window.innerWidth / window.innerHeight);
addBaseLighting(scene);

const product = new Mesh(
  new BoxGeometry(1.8, 0.85, 1.2),
  new MeshStandardMaterial({
    color: 0x151515,
    metalness: 0.7,
    roughness: 0.23,
  }),
);

product.position.set(0, 0.15, 0);
scene.add(product);

const composer = createPostprocessing(renderer, scene, camera);
initializeScrollStory(product);
initializeSceneLab({ renderer, camera });

const clock = new Clock();

function render(): void {
  const elapsed = clock.getElapsedTime();
  product.position.y = 0.15 + Math.sin(elapsed * 0.75) * 0.035;
  composer.render();
  window.requestAnimationFrame(render);
}

function handleResize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  composer.setSize(width, height);
}

window.addEventListener("resize", handleResize);
render();
