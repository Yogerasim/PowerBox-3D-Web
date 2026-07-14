import "./style.css";

import GUI from "lil-gui";
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PointLight,
  PMREMGenerator,
  Quaternion,
  RectAreaLight,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

interface CollectionEntry {
  name: string;
  slug: string;
  file: string;
  parent: string | null;
  children: string[];
  depth: number;
  defaultVisible: boolean;
  objectCount: number;
  fileSizeBytes: number;
}

interface LightEntry {
  name: string;
  type: "POINT" | "SUN" | "SPOT" | "AREA";
  color: [number, number, number];
  previewIntensity: number;
  matrix: number[];
  scale: [number, number, number];
  enabled: boolean;
  useShadow: boolean;
  customDistance: boolean;
  distance: number;
  spotSize?: number;
  spotBlend?: number;
  shape?: string;
  size?: number;
  sizeY?: number;
}

interface CameraEntry {
  name: string;
  matrix: number[];
  fovYDegrees: number;
  near: number;
  far: number;
  dof: {
    focusPosition: [number, number, number] | null;
    focusDistance: number;
  };
}

interface Manifest {
  scene: {
    worldColor: [number, number, number];
    exposureStops: number;
  };
  activeCamera: string | null;
  collections: CollectionEntry[];
  lights: LightEntry[];
  cameras: CameraEntry[];
  summary: {
    collectionCount: number;
    lightCount: number;
    cameraCount: number;
    totalGlbBytes: number;
  };
}

interface LoadedModule {
  entry: CollectionEntry;
  root: Object3D;
}

const baseURL = import.meta.env.BASE_URL;
const manifestURL = `${baseURL}assets/models/collections-manifest.json`;
const modulesBaseURL = `${baseURL}assets/models/collections/`;

const app = document.querySelector<HTMLDivElement>("#viewer-app")!;
if (!app) throw new Error("#viewer-app not found");

app.innerHTML = `
  <div class="viewer-stage" id="viewer-stage"></div>
  <header class="viewer-header">
    <div>
      <p class="viewer-eyebrow">PowerBox Scene Lab</p>
      <h1>Collection Viewer</h1>
    </div>
    <div class="viewer-stats" id="viewer-stats">Loading manifest…</div>
  </header>
  <div class="viewer-help">ЛКМ — вращение · колесо — приближение · ПКМ — панорама</div>
  <div class="viewer-progress" id="viewer-progress">Preparing scene…</div>
`;

const stage = document.querySelector<HTMLDivElement>("#viewer-stage")!;
const stats = document.querySelector<HTMLDivElement>("#viewer-stats")!;
const progress = document.querySelector<HTMLDivElement>("#viewer-progress")!;
if (!stage || !stats || !progress) throw new Error("Viewer UI failed");

RectAreaLightUniformsLib.init();

const renderer = new WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
});
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
stage.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x050505);

const camera = new PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 1000);
camera.position.set(6, 3.5, 8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.8, 0);
controls.update();

const modelRoot = new Group();
modelRoot.name = "POWERBOX_COLLECTION_MODULES";
scene.add(modelRoot);

const lightRoot = new Group();
lightRoot.name = "POWERBOX_BLENDER_LIGHTS";
scene.add(lightRoot);

const pmrem = new PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
scene.environmentIntensity = 0.8;
room.dispose();
pmrem.dispose();

const loader = new GLTFLoader();
const gui = new GUI({ title: "PowerBox Scene Lab", width: 340 });
const loaded = new Map<string, LoadedModule>();
const loading = new Map<string, Promise<LoadedModule>>();
const runtimeLights: Object3D[] = [];

let manifest: Manifest;
let loadedCount = 0;
let defaultLoadCount = 0;

const settings = {
  exposure: 1,
  environment: 0.8,
  lightMultiplier: 1,
  blenderLights: true,
  shadows: false,
};

function moduleURL(entry: CollectionEntry): string {
  return `${modulesBaseURL}${encodeURIComponent(entry.file)}`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setProgress(text: string, visible = true): void {
  progress.textContent = text;
  progress.classList.toggle("is-hidden", !visible);
}

function updateStats(): void {
  stats.innerHTML = `
    <span>${loadedCount}/${manifest.summary.collectionCount} modules loaded</span>
    <span>${manifest.summary.lightCount} Blender lights</span>
    <span>${formatSize(manifest.summary.totalGlbBytes)} exported GLB</span>
  `;
}

function configureMesh(object: Object3D): void {
  if (!(object instanceof Mesh)) return;
  object.castShadow = settings.shadows;
  object.receiveShadow = settings.shadows;
}

async function ensureLoaded(entry: CollectionEntry): Promise<LoadedModule> {
  const existing = loaded.get(entry.slug);
  if (existing) return existing;

  const existingPromise = loading.get(entry.slug);
  if (existingPromise) return existingPromise;

  const promise = loader.loadAsync(moduleURL(entry)).then((gltf) => {
    const root = gltf.scene;
    root.name = `COLLECTION__${entry.name}`;
    root.userData.collectionName = entry.name;
    root.visible = entry.defaultVisible;
    root.traverse(configureMesh);
    modelRoot.add(root);

    const module = { entry, root };
    loaded.set(entry.slug, module);
    loading.delete(entry.slug);
    loadedCount += 1;
    updateStats();
    setProgress(
      `Loaded ${loadedCount} of ${defaultLoadCount} visible modules`,
      loadedCount < defaultLoadCount,
    );
    return module;
  }).catch((error: unknown) => {
    loading.delete(entry.slug);
    console.error(`[PowerBox] Failed to load ${entry.name}`, error);
    setProgress(`Failed to load ${entry.name}. Open browser console.`, true);
    throw error;
  });

  loading.set(entry.slug, promise);
  return promise;
}

function applyMatrix(object: Object3D, values: number[]): void {
  new Matrix4().fromArray(values).decompose(
    object.position,
    object.quaternion,
    object.scale,
  );
}

function forward(quaternion: Quaternion): Vector3 {
  return new Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
}

function createLight(meta: LightEntry): Object3D | null {
  const color = new Color().fromArray(meta.color);
  const intensity = meta.previewIntensity;
  let light: Object3D | null = null;

  if (meta.type === "POINT") {
    const value = new PointLight(
      color,
      intensity,
      meta.customDistance ? meta.distance : 0,
      2,
    );
    applyMatrix(value, meta.matrix);
    light = value;
  }

  if (meta.type === "SUN") {
    const value = new DirectionalLight(color, intensity);
    applyMatrix(value, meta.matrix);
    value.target.position.copy(value.position).add(forward(value.quaternion));
    lightRoot.add(value.target);
    light = value;
  }

  if (meta.type === "SPOT") {
    const value = new SpotLight(
      color,
      intensity,
      meta.customDistance ? meta.distance : 0,
      meta.spotSize ?? Math.PI / 4,
      meta.spotBlend ?? 0.15,
      2,
    );
    applyMatrix(value, meta.matrix);
    value.target.position.copy(value.position).add(forward(value.quaternion));
    lightRoot.add(value.target);
    light = value;
  }

  if (meta.type === "AREA") {
    const width = (meta.size ?? 1) * Math.abs(meta.scale[0]);
    const sourceHeight = meta.shape === "RECTANGLE"
      ? meta.sizeY ?? meta.size ?? 1
      : meta.size ?? 1;
    const height = sourceHeight * Math.abs(meta.scale[1]);
    const value = new RectAreaLight(color, intensity, width, height);
    applyMatrix(value, meta.matrix);
    light = value;
  }

  if (!light) return null;
  light.name = meta.name;
  light.visible = meta.enabled;
  light.userData.baseIntensity = intensity;
  light.userData.useShadow = meta.useShadow;

  if (
    light instanceof PointLight ||
    light instanceof SpotLight ||
    light instanceof DirectionalLight
  ) {
    light.castShadow = settings.shadows && meta.useShadow;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.bias = -0.0001;
  }

  return light;
}

function rebuildLights(): void {
  lightRoot.clear();
  runtimeLights.length = 0;

  for (const meta of manifest.lights) {
    const light = createLight(meta);
    if (!light) continue;
    runtimeLights.push(light);
    lightRoot.add(light);
  }

  lightRoot.visible = settings.blenderLights;
  updateLightMultiplier();
}

function updateLightMultiplier(): void {
  for (const object of runtimeLights) {
    if (
      object instanceof PointLight ||
      object instanceof SpotLight ||
      object instanceof DirectionalLight ||
      object instanceof RectAreaLight
    ) {
      object.intensity = Number(object.userData.baseIntensity ?? 1) * settings.lightMultiplier;
    }
  }
}

function frameModels(): void {
  const box = new Box3().setFromObject(modelRoot);
  if (box.isEmpty()) return;

  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const radius = Math.max(size.length() * 0.5, 0.5);
  const distance = radius / Math.tan(camera.fov * Math.PI / 360);

  camera.position
    .copy(center)
    .addScaledVector(new Vector3(1, 0.55, 1).normalize(), distance * 1.15);
  camera.near = Math.max(radius / 100, 0.005);
  camera.far = Math.max(radius * 100, 100);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.maxDistance = radius * 20;
  controls.update();
}

function blenderCamera(): CameraEntry | undefined {
  return manifest.cameras.find((item) => item.name === manifest.activeCamera)
    ?? manifest.cameras[0];
}

function useBlenderCamera(): void {
  const meta = blenderCamera();
  if (!meta) return;

  const scale = new Vector3();
  new Matrix4().fromArray(meta.matrix).decompose(camera.position, camera.quaternion, scale);
  camera.fov = meta.fovYDegrees;
  camera.near = Math.max(meta.near, 0.001);
  camera.far = meta.far;
  camera.updateProjectionMatrix();

  if (meta.dof.focusPosition) {
    controls.target.fromArray(meta.dof.focusPosition);
  } else {
    controls.target.copy(camera.position).addScaledVector(
      forward(camera.quaternion),
      Math.max(meta.dof.focusDistance, 3),
    );
  }
  controls.update();
}

function buildGUI(): void {
  const sceneFolder = gui.addFolder("Scene");
  sceneFolder.add(settings, "exposure", 0.1, 4, 0.01).name("Exposure")
    .onChange((value: number) => { renderer.toneMappingExposure = value; });
  sceneFolder.add(settings, "environment", 0, 3, 0.01).name("Environment")
    .onChange((value: number) => { scene.environmentIntensity = value; });
  sceneFolder.add(settings, "lightMultiplier", 0, 10, 0.01).name("Light multiplier")
    .onChange(updateLightMultiplier);
  sceneFolder.add(settings, "blenderLights").name("Blender lights")
    .onChange((value: boolean) => { lightRoot.visible = value; });
  sceneFolder.add(settings, "shadows").name("Preview shadows")
    .onChange((enabled: boolean) => {
      renderer.shadowMap.enabled = enabled;
      modelRoot.traverse((object) => {
        if (object instanceof Mesh) {
          object.castShadow = enabled;
          object.receiveShadow = enabled;
        }
      });
      rebuildLights();
    });

  const cameraFolder = gui.addFolder("Camera");
  cameraFolder.add({ useBlenderCamera }, "useBlenderCamera").name("Use Blender camera");
  cameraFolder.add({ frameModels }, "frameModels").name("Frame loaded models");

  const collectionsFolder = gui.addFolder("Collections");
  for (const entry of manifest.collections) {
    const state = { visible: entry.defaultVisible };
    const indent = "· ".repeat(entry.depth);
    collectionsFolder.add(state, "visible")
      .name(`${indent}${entry.name} (${formatSize(entry.fileSizeBytes)})`)
      .onChange(async (visible: boolean) => {
        if (visible) {
          const module = await ensureLoaded(entry);
          module.root.visible = true;
        } else {
          const module = loaded.get(entry.slug);
          if (module) module.root.visible = false;
        }
      });
  }

  const actions = {
    loadAndShowAll: async () => {
      setProgress("Loading all modules…", true);
      await Promise.all(manifest.collections.map(async (entry) => {
        const module = await ensureLoaded(entry);
        module.root.visible = true;
      }));
      frameModels();
      setProgress("", false);
    },
    showLoaded: () => loaded.forEach((module) => { module.root.visible = true; }),
    hideLoaded: () => loaded.forEach((module) => { module.root.visible = false; }),
  };

  const actionsFolder = gui.addFolder("Actions");
  actionsFolder.add(actions, "loadAndShowAll").name("Load + show all");
  actionsFolder.add(actions, "showLoaded").name("Show loaded");
  actionsFolder.add(actions, "hideLoaded").name("Hide loaded");
}

async function initialize(): Promise<void> {
  const response = await fetch(manifestURL);
  if (!response.ok) {
    throw new Error(`Manifest request failed: ${response.status} ${response.statusText}`);
  }

  manifest = await response.json() as Manifest;
  scene.background = new Color().fromArray(manifest.scene.worldColor);
  settings.exposure = Math.max(0.1, Math.min(4, 2 ** manifest.scene.exposureStops));
  renderer.toneMappingExposure = settings.exposure;

  updateStats();
  rebuildLights();
  buildGUI();

  const defaults = manifest.collections.filter((entry) => entry.defaultVisible);
  defaultLoadCount = defaults.length;
  setProgress(`Loading ${defaults.length} visible modules…`, true);
  await Promise.all(defaults.map(ensureLoaded));
  setProgress("", false);

  if (blenderCamera()) useBlenderCamera();
  else frameModels();
}

function resize(): void {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
}

function render(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

addEventListener("resize", resize);
initialize().catch((error: unknown) => {
  console.error("[PowerBox] Viewer initialization failed", error);
  setProgress("Viewer failed. Run collection export and inspect browser console.", true);
});
render();
