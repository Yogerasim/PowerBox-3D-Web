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
  OrthographicCamera,
  PCFShadowMap,
  PMREMGenerator,
  PointLight,
  Quaternion,
  RectAreaLight,
  Scene,
  Sphere,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { createYokeLightRig } from "./yokeLights";
import { createRelayClickAudio } from "./relayClickAudio";
import {
  createPresentationCameraSystem,
  type SceneState,
} from "./presentationCameras";
import { loadSceneLabPreset } from "./sceneLabPreset";
import { Vector2 } from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { clone as cloneObject } from "three/addons/utils/SkeletonUtils.js";

import type {
  CameraEntry,
  CollectionEntry,
  InstanceEntry,
  LightEntry,
  Manifest,
  PrototypeEntry,
} from "./types";

const baseURL = import.meta.env.BASE_URL;

const manifestURL =
  `${baseURL}assets/models/collections-manifest.json`;

const collectionBaseURL =
  `${baseURL}assets/models/collections/`;

const prototypeBaseURL =
  `${baseURL}assets/models/prototypes/`;

const app = document.querySelector<HTMLDivElement>("#viewer-app");

if (!app) {
  throw new Error("Element #viewer-app was not found.");
}

/**
 * Те же классы, что использует текущий Scene Lab.
 * CSS и viewer.html не заменяются.
 */
app.innerHTML = `
  <div
    id="viewer-stage"
    class="viewer-stage stage"
  ></div>

  <header class="viewer-header header">
    <div>
      <p class="viewer-eyebrow">PowerBox Scene Lab</p>
      <h1>Collection Viewer</h1>
    </div>

    <div
      id="viewer-stats"
      class="viewer-stats stats"
    >
      Loading manifest…
    </div>
  </header>

  <div class="viewer-help">
    ЛКМ — вращение · колесо — масштаб · ПКМ — панорама
  </div>

  <div
    id="viewer-progress"
    class="viewer-progress status"
  >
    <span id="viewer-progress-text">
      Preparing scene…
    </span>
  </div>
`;

function requireElement<T extends Element>(
  selector: string,
): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(
      `Required viewer element was not found: ${selector}`,
    );
  }

  return element;
}

const stage =
  requireElement<HTMLDivElement>("#viewer-stage");

const stats =
  requireElement<HTMLDivElement>("#viewer-stats");

const progress =
  requireElement<HTMLDivElement>("#viewer-progress");

const progressText =
  requireElement<HTMLSpanElement>("#viewer-progress-text");

RectAreaLightUniformsLib.init();

const renderer = new WebGLRenderer({
  antialias: true,
  alpha: false,
  powerPreference: "high-performance",
});

renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = PCFShadowMap;

renderer.setPixelRatio(
  Math.min(
    window.devicePixelRatio,
    matchMedia("(max-width: 760px), (pointer: coarse)").matches
      ? 1.35
      : 2,
  ),
);

renderer.setSize(
  window.innerWidth,
  window.innerHeight,
);

stage.appendChild(renderer.domElement);
renderer.domElement.classList.add("is-loading");

const scene = new Scene();
scene.background = new Color(0x050505);

let orthographicHeight = 8;

const camera = new OrthographicCamera(
  -4,
  4,
  4,
  -4,
  0.01,
  1000,
);

camera.position.set(6, 3.5, 8);

function updateOrthographicProjection(): void {
  const width = Math.max(window.innerWidth, 1);
  const height = Math.max(window.innerHeight, 1);
  const aspect = width / height;

  const halfHeight = orthographicHeight * 0.5;
  const halfWidth = halfHeight * aspect;

  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;

  camera.updateProjectionMatrix();
}

updateOrthographicProjection();

const controls = new OrbitControls(
  camera,
  renderer.domElement,
);

controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.8, 0);
controls.update();

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new Vector2(window.innerWidth, window.innerHeight),
  0.65,
  0.35,
  1.1,
);
const bokehPass = new BokehPass(scene, camera, {
  focus: camera.position.distanceTo(controls.target),
  aperture: 0.003,
  maxblur: 0.012,
});
bokehPass.materialBokeh.defines.PERSPECTIVE_CAMERA = 0;
bokehPass.materialBokeh.needsUpdate = true;
bokehPass.setSize(window.innerWidth, window.innerHeight);

const bokehUniforms = bokehPass.uniforms as {
  focus: { value: number };
  aperture: { value: number };
  maxblur: { value: number };
};

const outputPass = new OutputPass();

composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(bokehPass);
composer.addPass(outputPass);
composer.setSize(window.innerWidth, window.innerHeight);

const postSettings = {
  bloom: true,
  bloomStrength: 0.65,
  bloomRadius: 0.35,
  bloomThreshold: 1.1,
  depthOfField: false,
  autoFocus: true,
  focusDistance: camera.position.distanceTo(controls.target),
  aperture: 0.003,
  maxBlur: 0.012,
};

bloomPass.enabled = postSettings.bloom;
bokehPass.enabled = postSettings.depthOfField;

const modelRoot = new Group();
modelRoot.name = "POWERBOX_GROUPS";

const lightRoot = new Group();
lightRoot.name = "POWERBOX_BLENDER_LIGHTS";

scene.add(modelRoot, lightRoot);

const yokeLightRig = createYokeLightRig();
const relayClickAudio = createRelayClickAudio();
yokeLightRig.setSwitchListener(relayClickAudio.play);
scene.add(yokeLightRig.root);

const pmremGenerator = new PMREMGenerator(renderer);
const roomEnvironment = new RoomEnvironment();

const environmentRenderTarget =
  pmremGenerator.fromScene(roomEnvironment, 0.04);

scene.environment = environmentRenderTarget.texture;
scene.environmentIntensity = 0.03;

roomEnvironment.dispose();
pmremGenerator.dispose();

const loader = new GLTFLoader();

const gui = new GUI({
  title: "PowerBox Scene Lab",
  width: Math.min(390, window.innerWidth - 16),
});
interface LoadedGroup {
  entry: CollectionEntry;
  root: Group;
}

const loadedGroups =
  new Map<string, LoadedGroup>();

const loadingGroups =
  new Map<string, Promise<LoadedGroup>>();

const loadedPrototypes =
  new Map<string, Object3D>();

const loadingPrototypes =
  new Map<string, Promise<Object3D>>();

const runtimeLights: Array<
  PointLight |
  SpotLight |
  DirectionalLight |
  RectAreaLight
> = [];

let manifest: Manifest;
let loadedGroupCount = 0;
let targetGroupCount = 0;

const settings = {
  exposure: 1,
  environment: 0.03,
  lightMultiplier: 1,
  shadows: false,
  showBlenderLights: false,
};

const energyState = {
  autoPauseMinutes: 5,
  paused: false,
  status: "Running · auto-pause in 5 min",
};

let renderRequested = true;
let energyTimer: number | null = null;

function requestRender(): void {
  renderRequested = true;
}

function scheduleEnergyPause(): void {
  if (energyTimer !== null) {
    window.clearTimeout(energyTimer);
  }

  const delay = Math.max(0.1, energyState.autoPauseMinutes) * 60_000;
  energyState.status =
    `Running · auto-pause in ${energyState.autoPauseMinutes} min`;
  energyTimer = window.setTimeout(() => {
    setEnergyPaused(true, "Frozen after time limit");
  }, delay);
}

function setEnergyPaused(paused: boolean, reason = "Paused manually"): void {
  energyState.paused = paused;
  yokeLightRig.setAnimationPaused(paused);
  renderer.shadowMap.autoUpdate = !paused;

  if (paused) {
    energyState.status = reason;
    if (energyTimer !== null) window.clearTimeout(energyTimer);
    energyTimer = null;
  } else {
    renderer.shadowMap.needsUpdate = true;
    scheduleEnergyPause();
  }

  requestRender();
  gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
}

function getSceneState(): SceneState {
  return {
    exposure: settings.exposure,
    environment: settings.environment,
    shadows: settings.shadows,
    postFX: structuredClone(postSettings),
    yoke: yokeLightRig.getState(),
  };
}

function applySceneState(state: SceneState): void {
  settings.exposure = state.exposure;
  settings.environment = state.environment;
  settings.shadows = state.shadows;
  Object.assign(postSettings, structuredClone(state.postFX));
  renderer.toneMappingExposure = settings.exposure;
  scene.environmentIntensity = settings.environment;
  renderer.shadowMap.enabled = settings.shadows;
  bloomPass.enabled = postSettings.bloom;
  bloomPass.strength = postSettings.bloomStrength;
  bloomPass.radius = postSettings.bloomRadius;
  bloomPass.threshold = postSettings.bloomThreshold;
  bokehPass.enabled = postSettings.depthOfField;
  modelRoot.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = settings.shadows;
      object.receiveShadow = settings.shadows;
    }
  });
  yokeLightRig.applyState(state.yoke);
  requestRender();
  gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
}

const presentationCameraSystem = createPresentationCameraSystem({
  camera,
  controls,
  canvas: renderer.domElement,
  getOrthographicHeight: () => orthographicHeight,
  setOrthographicHeight: (value) => {
    orthographicHeight = value;
  },
  updateProjection: updateOrthographicProjection,
  getSceneState,
  applySceneState,
  setInteractiveChannel: yokeLightRig.setInteractiveChannel,
  setPerformanceControls: yokeLightRig.setPerformanceControls,
  requestRender,
});

function setProgress(
  message: string,
  visible = true,
): void {
  progressText.textContent = message;
  progress.classList.toggle("is-hidden", !visible);
  progress.classList.toggle("hidden", !visible);
}

function formattedSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function updateStats(): void {
  stats.innerHTML = `
    <span>
      ${loadedGroupCount}/${manifest.summary.collectionCount} groups
    </span>

    <span>
      ${manifest.summary.instanceCount} instances
    </span>

    <span>
      ${formattedSize(manifest.summary.totalGlbBytes)} GLB
    </span>
  `;
}

function configureMesh(object: Object3D): void {
  if (!(object instanceof Mesh)) {
    return;
  }

  object.castShadow = settings.shadows;
  object.receiveShadow = settings.shadows;
}

function applyMatrix(
  object: Object3D,
  values: number[],
): void {
  const matrix = new Matrix4().fromArray(values);
  const scale = new Vector3();

  matrix.decompose(
    object.position,
    object.quaternion,
    scale,
  );

  object.scale.copy(scale);
  object.updateMatrix();
  object.updateMatrixWorld(true);
}

function prototypeEntry(
  asset: string,
): PrototypeEntry {
  const entry = manifest.prototypes.find(
    (item) => item.asset === asset,
  );

  if (!entry) {
    throw new Error(
      `Prototype was not found for asset "${asset}".`,
    );
  }

  return entry;
}

async function ensurePrototypeLoaded(
  asset: string,
): Promise<Object3D> {
  const existing = loadedPrototypes.get(asset);

  if (existing) {
    return existing;
  }

  const pending = loadingPrototypes.get(asset);

  if (pending) {
    return pending;
  }

  const entry = prototypeEntry(asset);

  const request = loader
    .loadAsync(
      `${prototypeBaseURL}${encodeURIComponent(entry.file)}`,
    )
    .then((gltf) => {
      const root = gltf.scene;

      root.name = `PROTOTYPE__${asset}`;
      root.visible = false;
      root.traverse(configureMesh);

      loadedPrototypes.set(asset, root);
      loadingPrototypes.delete(asset);

      return root;
    })
    .catch((error: unknown) => {
      loadingPrototypes.delete(asset);
      throw error;
    });

  loadingPrototypes.set(asset, request);
  return request;
}

function instancesForGroup(
  groupName: string,
): InstanceEntry[] {
  return manifest.instances.filter(
    (instance) => instance.group === groupName,
  );
}

async function loadInstancesIntoGroup(
  entry: CollectionEntry,
  groupRoot: Group,
): Promise<void> {
  const instances = instancesForGroup(entry.name);

  const assets = [
    ...new Set(
      instances.map((instance) => instance.asset),
    ),
  ];

  await Promise.all(
    assets.map((asset) => ensurePrototypeLoaded(asset)),
  );

  for (const instance of instances) {
    const prototype =
      loadedPrototypes.get(instance.asset);

    if (!prototype) {
      throw new Error(
        `Prototype "${instance.asset}" was not loaded.`,
      );
    }

    const clone = cloneObject(prototype);

    clone.name = instance.name;
    clone.visible = true;
    clone.userData.asset = instance.asset;
    clone.userData.group = instance.group;

    applyMatrix(clone, instance.matrix);
    clone.traverse(configureMesh);

    if (entry.name === "Led_Lights") {
      yokeLightRig.registerLedLightRoot(clone);
    }

    groupRoot.add(clone);
  }
}

async function ensureGroupLoaded(
  entry: CollectionEntry,
): Promise<LoadedGroup> {
  const existing = loadedGroups.get(entry.slug);

  if (existing) {
    return existing;
  }

  const pending = loadingGroups.get(entry.slug);

  if (pending) {
    return pending;
  }

  const request = (async (): Promise<LoadedGroup> => {
    const groupRoot = new Group();

    groupRoot.name = `GROUP__${entry.name}`;
    groupRoot.userData.collectionName = entry.name;
    groupRoot.visible = entry.defaultVisible;

    if (entry.file) {
      const gltf = await loader.loadAsync(
        `${collectionBaseURL}${encodeURIComponent(entry.file)}`,
      );

      gltf.scene.name = `COLLECTION_MODULE__${entry.name}`;
      gltf.scene.traverse(configureMesh);
      groupRoot.add(gltf.scene);
    }

    await loadInstancesIntoGroup(entry, groupRoot);

    modelRoot.add(groupRoot);

    const loaded = {
      entry,
      root: groupRoot,
    };

    loadedGroups.set(entry.slug, loaded);
    loadingGroups.delete(entry.slug);

    loadedGroupCount += 1;
    updateStats();

    setProgress(
      `Loaded ${loadedGroupCount} of ${targetGroupCount} groups`,
      loadedGroupCount < targetGroupCount,
    );

    return loaded;
  })().catch((error: unknown) => {
    loadingGroups.delete(entry.slug);

    console.error(
      `[PowerBox] Failed to load group "${entry.name}".`,
      error,
    );

    setProgress(
      `Failed to load ${entry.name}. Check console.`,
      true,
    );

    throw error;
  });

  loadingGroups.set(entry.slug, request);
  return request;
}

function forwardDirection(
  quaternion: Quaternion,
): Vector3 {
  return new Vector3(0, 0, -1)
    .applyQuaternion(quaternion)
    .normalize();
}

function previewIntensity(
  metadata: LightEntry,
): number {
  const energy = Math.max(metadata.energy, 0);

  if (metadata.type === "SUN") {
    return Math.max(0.05, energy * 0.001);
  }

  if (metadata.type === "AREA") {
    return Math.max(0.05, energy * 0.02);
  }

  return Math.max(0.05, energy * 0.03);
}

function createRuntimeLight(
  metadata: LightEntry,
):
  | PointLight
  | SpotLight
  | DirectionalLight
  | RectAreaLight {
  const color = new Color().fromArray(metadata.color);
  const intensity = previewIntensity(metadata);

  if (metadata.type === "POINT") {
    const light = new PointLight(
      color,
      intensity,
      metadata.distance > 0
        ? metadata.distance
        : 0,
      2,
    );

    applyMatrix(light, metadata.matrix);
    return light;
  }

  if (metadata.type === "SPOT") {
    const light = new SpotLight(
      color,
      intensity,
      metadata.distance > 0
        ? metadata.distance
        : 0,
      metadata.spotSize ?? Math.PI / 4,
      metadata.spotBlend ?? 0.15,
      2,
    );

    applyMatrix(light, metadata.matrix);

    light.target.position
      .copy(light.position)
      .add(forwardDirection(light.quaternion));

    lightRoot.add(light.target);
    return light;
  }

  if (metadata.type === "SUN") {
    const light = new DirectionalLight(
      color,
      intensity,
    );

    applyMatrix(light, metadata.matrix);

    light.target.position
      .copy(light.position)
      .add(forwardDirection(light.quaternion));

    lightRoot.add(light.target);
    return light;
  }

  const width = metadata.size ?? 1;

  const height =
    metadata.shape === "RECTANGLE"
      ? metadata.sizeY ?? width
      : width;

  const light = new RectAreaLight(
    color,
    intensity,
    width,
    height,
  );

  applyMatrix(light, metadata.matrix);
  return light;
}

function updateLightMultiplier(): void {
  for (const light of runtimeLights) {
    light.intensity =
      Number(light.userData.baseIntensity ?? 1) *
      settings.lightMultiplier;
  }
}

function rebuildLights(): void {
  lightRoot.clear();
  runtimeLights.length = 0;

  for (const metadata of manifest.lights) {
    const light = createRuntimeLight(metadata);

    light.name = metadata.name;
    light.visible = metadata.enabled;
    light.userData.baseIntensity = light.intensity;

    if (
      light instanceof PointLight ||
      light instanceof SpotLight ||
      light instanceof DirectionalLight
    ) {
      light.castShadow =
        settings.shadows && metadata.useShadow;

      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0001;
    }

    runtimeLights.push(light);
    lightRoot.add(light);
  }

  lightRoot.visible = settings.showBlenderLights;
  updateLightMultiplier();
}

function sceneBoundingSphere(): Sphere | null {
  const box = new Box3().setFromObject(modelRoot);

  if (box.isEmpty()) {
    return null;
  }

  return box.getBoundingSphere(new Sphere());
}

function fitCameraToModels(): void {
  const sphere = sceneBoundingSphere();

  if (!sphere) {
    return;
  }

  const radius = Math.max(sphere.radius, 0.25);

  let direction = camera.position
    .clone()
    .sub(controls.target);

  if (direction.lengthSq() < 0.0001) {
    direction.set(1, 0.55, 1);
  }

  direction.normalize();

  camera.position
    .copy(sphere.center)
    .addScaledVector(
      direction,
      Math.max(radius * 3, 4),
    );

  camera.near = Math.max(radius / 100, 0.005);
  camera.far = Math.max(radius * 100, 100);

  orthographicHeight = Math.max(
    radius * 2.35,
    0.5,
  );

  camera.zoom = 1;
  controls.target.copy(sphere.center);

  updateOrthographicProjection();
  controls.update();
}

function selectedBlenderCamera():
  | CameraEntry
  | undefined {
  return (
    manifest.cameras.find(
      (entry) => entry.name === manifest.activeCamera,
    )
    ?? manifest.cameras[0]
  );
}

function useBlenderCamera(
  metadata: CameraEntry,
): void {
  const matrix = new Matrix4().fromArray(metadata.matrix);
  const unusedScale = new Vector3();

  matrix.decompose(
    camera.position,
    camera.quaternion,
    unusedScale,
  );

  camera.near = Math.max(metadata.near, 0.001);
  camera.far = metadata.far;
  camera.zoom = 1;

  if (
    metadata.type === "ORTHO" &&
    metadata.orthoScale > 0
  ) {
    orthographicHeight = metadata.orthoScale;
  } else {
    const sphere = sceneBoundingSphere();

    if (sphere) {
      orthographicHeight = Math.max(
        sphere.radius * 2.35,
        0.5,
      );
    }
  }

  controls.target
    .copy(camera.position)
    .addScaledVector(
      forwardDirection(camera.quaternion),
      Math.max(metadata.dof.focusDistance, 3),
    );

  updateOrthographicProjection();
  controls.update();
}

function addViewerGUI(): void {
  const sceneFolder = gui.addFolder("Scene");

  sceneFolder
    .add(settings, "exposure", 0.1, 4, 0.01)
    .name("Exposure")
    .onChange((value: number) => {
      renderer.toneMappingExposure = value;
    });

  sceneFolder
    .add(settings, "environment", 0, 3, 0.01)
    .name("Environment")
    .onChange((value: number) => {
      scene.environmentIntensity = value;
    });

  sceneFolder
    .add(settings, "lightMultiplier", 0, 10, 0.01)
    .name("Light multiplier")
    .onChange(updateLightMultiplier);

  sceneFolder
    .add(settings, "showBlenderLights")
    .name("Blender lights")
    .onChange((value: boolean) => {
      lightRoot.visible = value;
    });

  sceneFolder
    .add(settings, "shadows")
    .name("Preview shadows")
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

  yokeLightRig.addGUI(gui);
  relayClickAudio.addGUI(gui);

  const energyFolder = gui.addFolder("Performance guard");

  energyFolder
    .add(energyState, "autoPauseMinutes", 1, 20, 1)
    .name("Freeze after min")
    .onChange(() => {
      if (!energyState.paused) scheduleEnergyPause();
    });

  energyFolder
    .add(energyState, "paused")
    .name("Animation frozen")
    .listen()
    .onChange((paused: boolean) => setEnergyPaused(paused));

  energyFolder
    .add({ resume: () => setEnergyPaused(false) }, "resume")
    .name("Resume + reset timer");

  energyFolder
    .add(energyState, "status")
    .name("Status")
    .listen()
    .disable();

  const postFolder = gui.addFolder("Post FX");

  postFolder
    .add(postSettings, "bloom")
    .name("Bloom")
    .onChange((value: boolean) => {
      bloomPass.enabled = value;
    });

  postFolder
    .add(postSettings, "bloomStrength", 0, 3, 0.01)
    .name("Bloom strength")
    .onChange((value: number) => {
      bloomPass.strength = value;
    });

  postFolder
    .add(postSettings, "bloomRadius", 0, 1, 0.01)
    .name("Bloom radius")
    .onChange((value: number) => {
      bloomPass.radius = value;
    });

  postFolder
    .add(postSettings, "bloomThreshold", 0, 3, 0.01)
    .name("Bloom threshold")
    .onChange((value: number) => {
      bloomPass.threshold = value;
    });

  const dofFolder = postFolder.addFolder("Depth of field");

  dofFolder
    .add(postSettings, "depthOfField")
    .name("Enabled")
    .onChange((value: boolean) => {
      bokehPass.enabled = value;
    });

  dofFolder
    .add(postSettings, "autoFocus")
    .name("Focus on target");

  dofFolder
    .add(postSettings, "focusDistance", 0.1, 30, 0.01)
    .name("Focus distance");

  dofFolder
    .add(postSettings, "aperture", 0, 0.02, 0.0001)
    .name("Aperture");

  dofFolder
    .add(postSettings, "maxBlur", 0, 0.05, 0.0005)
    .name("Max blur");

  const cameraActions = {
    useBlenderCamera: () => {
      const blenderCamera = selectedBlenderCamera();

      if (blenderCamera) {
        useBlenderCamera(blenderCamera);
      }
    },

    frameLoadedModels: fitCameraToModels,
  };

  const cameraFolder = gui.addFolder("Camera");

  cameraFolder
    .add(cameraActions, "useBlenderCamera")
    .name("Use Blender camera");

  cameraFolder
    .add(cameraActions, "frameLoadedModels")
    .name("Frame loaded models");

  const collectionFolder =
    gui.addFolder("Collections");

  for (const entry of manifest.collections) {
    const state = {
      visible: entry.defaultVisible,
    };

    const size =
      entry.fileSizeBytes > 0
        ? formattedSize(entry.fileSizeBytes)
        : `${entry.instanceCount} instances`;

    collectionFolder
      .add(state, "visible")
      .name(`${entry.name} (${size})`)
      .onChange(async (visible: boolean) => {
        if (visible) {
          const loaded = await ensureGroupLoaded(entry);
          loaded.root.visible = true;
        } else {
          const loaded = loadedGroups.get(entry.slug);

          if (loaded) {
            loaded.root.visible = false;
          }
        }
      });
  }

  const actions = {
    loadAndShowAll: async () => {
      targetGroupCount = manifest.collections.length;

      setProgress(
        "Loading all groups…",
        true,
      );

      await Promise.all(
        manifest.collections.map(async (entry) => {
          const loaded = await ensureGroupLoaded(entry);
          loaded.root.visible = true;
        }),
      );

      fitCameraToModels();
      setProgress("", false);
    },

    showAllLoaded: () => {
      for (const loaded of loadedGroups.values()) {
        loaded.root.visible = true;
      }
    },

    hideAllLoaded: () => {
      for (const loaded of loadedGroups.values()) {
        loaded.root.visible = false;
      }
    },
  };

  const actionsFolder = gui.addFolder("Actions");

  actionsFolder
    .add(actions, "loadAndShowAll")
    .name("Load + show all");

  actionsFolder
    .add(actions, "showAllLoaded")
    .name("Show loaded");

  actionsFolder
    .add(actions, "hideAllLoaded")
    .name("Hide loaded");
}

async function loadDefaultGroups(): Promise<void> {
  const entries = manifest.collections.filter(
    (entry) => entry.defaultVisible,
  );

  targetGroupCount = entries.length;

  setProgress(
    `Loading ${entries.length} visible groups…`,
    true,
  );

  await Promise.all(
    entries.map((entry) => ensureGroupLoaded(entry)),
  );

  const blenderCamera = selectedBlenderCamera();

  if (blenderCamera) {
    useBlenderCamera(blenderCamera);
  } else {
    fitCameraToModels();
  }

  setProgress("", false);
}

async function initialize(): Promise<void> {
  const response = await fetch(manifestURL);

  if (!response.ok) {
    throw new Error(
      `Manifest request failed: ${response.status}`,
    );
  }

  manifest = await response.json() as Manifest;

  scene.background = new Color().fromArray(
    manifest.scene.worldColor,
  );

  settings.exposure = Math.max(
    0.1,
    Math.min(
      4,
      2 ** manifest.scene.exposureStops,
    ),
  );

  renderer.toneMappingExposure = settings.exposure;

  updateStats();
  rebuildLights();
  await presentationCameraSystem.load();
  addViewerGUI();
  presentationCameraSystem.addGUI(gui);
  await loadSceneLabPreset(gui);
  await loadDefaultGroups();
  presentationCameraSystem.markSceneReady();
  scheduleEnergyPause();
}

function resize(): void {
  renderer.setPixelRatio(
    Math.min(
      window.devicePixelRatio,
      matchMedia("(max-width: 760px), (pointer: coarse)").matches
        ? 1.35
        : 2,
    ),
  );

  renderer.setSize(
    window.innerWidth,
    window.innerHeight,
  );

  composer.setSize(window.innerWidth, window.innerHeight);
  bokehPass.setSize(window.innerWidth, window.innerHeight);
  updateOrthographicProjection();
  presentationCameraSystem.refresh();
}

function render(): void {
  controls.update();
  presentationCameraSystem.update();
  if (postSettings.depthOfField) {
    const focusDistance = postSettings.autoFocus
      ? camera.position.distanceTo(controls.target)
      : postSettings.focusDistance;

    bokehUniforms.focus.value = focusDistance;
    bokehUniforms.aperture.value =
      postSettings.aperture;
    bokehUniforms.maxblur.value =
      postSettings.maxBlur;
  }

  if (!energyState.paused) {
    yokeLightRig.update(performance.now() * 0.001);
    composer.render();
  } else if (renderRequested) {
    composer.render();
    renderRequested = false;
  }
  requestAnimationFrame(render);
}

window.addEventListener("resize", resize);
controls.addEventListener("change", requestRender);
gui.onChange(requestRender);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    setEnergyPaused(true, "Frozen while tab is hidden");
  }
});

initialize().catch((error: unknown) => {
  console.error(
    "[PowerBox] Scene Lab initialization failed.",
    error,
  );

  setProgress(
    "Viewer failed. Check the browser console.",
    true,
  );
});

render();
