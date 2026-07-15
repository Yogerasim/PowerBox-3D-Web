import type GUI from "lil-gui";
import { MathUtils, OrthographicCamera, Vector3 } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { storySections } from "../website/sections";

gsap.registerPlugin(ScrollTrigger);

export interface PresentationCameraShot {
  id: string;
  label: string;
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
  orthographicHeight: number;
  dof: {
    enabled: boolean;
    autoFocus: boolean;
    focusDistance: number;
    aperture: number;
    maxBlur: number;
  };
}

export interface PresentationCameraConfig {
  version: 1;
  shots: PresentationCameraShot[];
}

interface PostSettings {
  depthOfField: boolean;
  autoFocus: boolean;
  focusDistance: number;
  aperture: number;
  maxBlur: number;
}

interface Options {
  camera: OrthographicCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  postSettings: PostSettings;
  getOrthographicHeight: () => number;
  setOrthographicHeight: (value: number) => void;
  updateProjection: () => void;
}

export interface PresentationCameraSystem {
  load: () => Promise<void>;
  addGUI: (gui: GUI) => void;
  markSceneReady: () => void;
  update: () => void;
  refreshScroll: () => void;
}

const CONFIG_URL = `${import.meta.env.BASE_URL}config/presentation-cameras.json`;
const STORAGE_KEY = "powerbox.presentation-cameras.v1";

function isLocalEditor(): boolean {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function tuple(vector: Vector3): [number, number, number] {
  return [
    Number(vector.x.toFixed(6)),
    Number(vector.y.toFixed(6)),
    Number(vector.z.toFixed(6)),
  ];
}

function fallbackConfig(): PresentationCameraConfig {
  const positions: Array<[number, number, number]> = [
    [6, 3.5, 8],
    [4.8, 2.2, 5.2],
    [0.2, 7, 0.2],
    [-5, 2.4, 5],
    [2.5, 1.4, 3],
    [7, 4.5, -7],
    [5, 2.7, 7],
  ];

  const targets: Array<[number, number, number]> = [
    [0, 0.8, 0],
    [0, 0.55, 0],
    [0, 0.2, 0],
    [0, 0.65, 0],
    [0, 0.45, 0],
    [0, 0.8, 0],
    [0, 0.7, 0],
  ];

  const zooms = [1, 1.15, 0.9, 1.05, 1.35, 0.82, 1.08];

  return {
    version: 1,
    shots: storySections.map((section, index) => ({
      id: section.id,
      label: section.title,
      position: positions[index],
      target: targets[index],
      zoom: zooms[index],
      orthographicHeight: 8,
      dof: {
        enabled: true,
        autoFocus: true,
        focusDistance: 23.94,
        aperture: 0.02,
        maxBlur: 0.016,
      },
    })),
  };
}

function isConfig(value: unknown): value is PresentationCameraConfig {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PresentationCameraConfig>;
  return candidate.version === 1 &&
    Array.isArray(candidate.shots) &&
    candidate.shots.length === storySections.length;
}

function downloadConfig(config: PresentationCameraConfig): void {
  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "powerbox-presentation-cameras.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createPresentationCameraSystem(options: Options): PresentationCameraSystem {
  let config = fallbackConfig();
  let committedConfig = fallbackConfig();
  let timeline: gsap.core.Timeline | null = null;
  let sceneReady = false;

  const state = {
    currentShot: storySections[0].id,
    storyPreview: false,
    showText: true,
    scrollSmoothing: 0.65,
    status: "Loading cameras…",
  };

  const readout = {
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    zoom: 1,
  };

  const storyRoot = document.createElement("main");
  storyRoot.id = "presentation-story-preview";
  storyRoot.className = "presentation-story-preview";
  storyRoot.hidden = true;
  storyRoot.innerHTML = storySections.map((section, index) => `
    <section class="presentation-story-section" data-story-id="${section.id}">
      <div class="presentation-story-copy">
        <p class="presentation-story-index">${String(index + 1).padStart(2, "0")} / ${String(storySections.length).padStart(2, "0")}</p>
        <p class="presentation-story-eyebrow">${section.eyebrow}</p>
        <h2>${section.title}</h2>
        <p class="presentation-story-body">${section.body}</p>
      </div>
    </section>
  `).join("");
  document.body.appendChild(storyRoot);

  function shotById(id: string): PresentationCameraShot {
    return config.shots.find((shot) => shot.id === id) ?? config.shots[0];
  }

  function updateReadout(): void {
    readout.positionX = options.camera.position.x;
    readout.positionY = options.camera.position.y;
    readout.positionZ = options.camera.position.z;
    readout.targetX = options.controls.target.x;
    readout.targetY = options.controls.target.y;
    readout.targetZ = options.controls.target.z;
    readout.zoom = options.camera.zoom;
  }

  function applyShot(shot: PresentationCameraShot): void {
    killTimeline();
    options.camera.position.fromArray(shot.position);
    options.controls.target.fromArray(shot.target);
    options.camera.zoom = shot.zoom;
    options.setOrthographicHeight(shot.orthographicHeight);
    options.postSettings.depthOfField = shot.dof.enabled;
    options.postSettings.autoFocus = shot.dof.autoFocus;
    options.postSettings.focusDistance = shot.dof.focusDistance;
    options.postSettings.aperture = shot.dof.aperture;
    options.postSettings.maxBlur = shot.dof.maxBlur;
    options.updateProjection();
    options.controls.update();
    updateReadout();
  }

  function saveDraft(): void {
    if (isLocalEditor()) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
  }

  function captureCurrent(): void {
    const shot = shotById(state.currentShot);
    shot.position = tuple(options.camera.position);
    shot.target = tuple(options.controls.target);
    shot.zoom = Number(options.camera.zoom.toFixed(6));
    shot.orthographicHeight = Number(options.getOrthographicHeight().toFixed(6));
    shot.dof = {
      enabled: options.postSettings.depthOfField,
      autoFocus: options.postSettings.autoFocus,
      focusDistance: Number(options.postSettings.focusDistance.toFixed(6)),
      aperture: Number(options.postSettings.aperture.toFixed(6)),
      maxBlur: Number(options.postSettings.maxBlur.toFixed(6)),
    };
    saveDraft();
    state.status = `Saved locally: ${shot.id}`;
    console.info("[PowerBox] Camera shot captured", shot);
  }

  function killTimeline(): void {
    timeline?.scrollTrigger?.kill();
    timeline?.kill();
    timeline = null;
  }

  function buildTimeline(): void {
    killTimeline();
    if (!state.storyPreview || !sceneReady) return;

    const shots = storySections.map((section) => shotById(section.id));
    const first = shots[0];
    applyShot(first);

    const target = { x: first.target[0], y: first.target[1], z: first.target[2] };
    const framing = { height: first.orthographicHeight };

    timeline = gsap.timeline({
      defaults: { ease: "none" },
      scrollTrigger: {
        trigger: storyRoot,
        start: "top top",
        end: "bottom bottom",
        scrub: state.scrollSmoothing,
        snap: {
          snapTo:
            1 / Math.max(
              shots.length - 1,
              1,
            ),
          duration: {
            min: 0.18,
            max: 0.45,
          },
          delay: 0.04,
          ease: "power1.inOut",
        },
        invalidateOnRefresh: true,
        onUpdate: (trigger) => {
          const index = MathUtils.clamp(
            Math.round(trigger.progress * (shots.length - 1)),
            0,
            shots.length - 1,
          );
          options.postSettings.depthOfField = shots[index].dof.enabled;
          options.postSettings.autoFocus = shots[index].dof.autoFocus;
        },
      },
    });

    shots.slice(1).forEach((shot, index) => {
      timeline
        ?.to(options.camera.position, {
          x: shot.position[0],
          y: shot.position[1],
          z: shot.position[2],
          duration: 1,
        }, index)
        .to(target, {
          x: shot.target[0],
          y: shot.target[1],
          z: shot.target[2],
          duration: 1,
          onUpdate: () => options.controls.target.set(target.x, target.y, target.z),
        }, index)
        .to(options.camera, {
          zoom: shot.zoom,
          duration: 1,
          onUpdate: options.updateProjection,
        }, index)
        .to(framing, {
          height: shot.orthographicHeight,
          duration: 1,
          onUpdate: () => {
            options.setOrthographicHeight(framing.height);
            options.updateProjection();
          },
        }, index)
        .to(options.postSettings, {
          focusDistance: shot.dof.focusDistance,
          aperture: shot.dof.aperture,
          maxBlur: shot.dof.maxBlur,
          duration: 1,
        }, index);
    });

    requestAnimationFrame(() => ScrollTrigger.refresh());
  }

  function setStoryPreview(enabled: boolean): void {
    state.storyPreview = enabled;
    document.body.classList.toggle(
    "presentation-story-mode",
    enabled,
  );

  document.documentElement.classList.toggle(
    "presentation-story-mode",
    enabled,
  );

  storyRoot.style.pointerEvents =
    enabled ? "auto" : "none";

  options.canvas.style.pointerEvents =
    enabled ? "none" : "auto";

  options.canvas.style.touchAction =
    enabled ? "pan-y" : "none";
    storyRoot.hidden = !enabled;
    options.controls.enabled = !enabled;
    if (enabled) {
      window.scrollTo(0, 0);
      buildTimeline();
    } else {
      killTimeline();
    }
  }

  function moveShot(direction: number): void {
    const index = config.shots.findIndex((shot) => shot.id === state.currentShot);
    const next = MathUtils.euclideanModulo(index + direction, config.shots.length);
    state.currentShot = config.shots[next].id;
    applyShot(config.shots[next]);
  }

  async function load(): Promise<void> {
    try {
      const response = await fetch(CONFIG_URL, { cache: "no-store" });
      if (response.ok) {
        const value = await response.json() as unknown;
        if (isConfig(value)) {
          committedConfig = structuredClone(value);
          config = structuredClone(value);
        }
      }
    } catch (error) {
      console.warn("[PowerBox] Presentation camera config was not loaded", error);
    }

    if (isLocalEditor()) {
      const draft = localStorage.getItem(STORAGE_KEY);
      if (draft) {
        try {
          const value = JSON.parse(draft) as unknown;
          if (isConfig(value)) {
            config = value;
            state.status = "Loaded local camera draft";
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    }

    if (state.status === "Loading cameras…") {
      state.status = "Committed cameras loaded";
    }

    state.storyPreview = new URLSearchParams(location.search).get("story") === "1";
  }

  function addGUI(gui: GUI): void {
    const folder = gui.addFolder("Presentation Cameras");
    const optionsMap = Object.fromEntries(config.shots.map((shot, index) => [
      `${index + 1} · ${shot.label}`,
      shot.id,
    ]));

    folder.add(state, "currentShot", optionsMap).name("Current shot");
    folder.add({ capture: captureCurrent }, "capture").name("Capture current camera");
    folder.add({ preview: () => applyShot(shotById(state.currentShot)) }, "preview").name("Go to current shot");
    folder.add({ previous: () => moveShot(-1) }, "previous").name("Previous shot");
    folder.add({ next: () => moveShot(1) }, "next").name("Next shot");
    folder.add(state, "storyPreview").name("Story scroll preview").onChange(setStoryPreview);
    folder.add(state, "showText").name("Show story text").onChange((visible: boolean) => {
      storyRoot.classList.toggle("hide-story-text", !visible);
    });
    folder.add(state, "scrollSmoothing", 0, 2, 0.01).name("Scroll smoothing").onFinishChange(buildTimeline);
    folder.add({ download: () => downloadConfig(config) }, "download").name("Download cameras JSON");
    folder.add({ reset: () => {
      config = structuredClone(committedConfig);
      localStorage.removeItem(STORAGE_KEY);
      state.status = "Local draft cleared";
      applyShot(shotById(state.currentShot));
    } }, "reset").name("Reset local camera draft");
    folder.add(state, "status").name("Status").listen().disable();

    const current = folder.addFolder("Current camera");
    current.add(readout, "positionX").name("Position X").listen().disable();
    current.add(readout, "positionY").name("Position Y").listen().disable();
    current.add(readout, "positionZ").name("Position Z").listen().disable();
    current.add(readout, "targetX").name("Target X").listen().disable();
    current.add(readout, "targetY").name("Target Y").listen().disable();
    current.add(readout, "targetZ").name("Target Z").listen().disable();
    current.add(readout, "zoom").name("Zoom").listen().disable();
    updateReadout();
  }

  function markSceneReady(): void {
    sceneReady = true;
    options.canvas.classList.remove("is-loading");
    if (state.storyPreview) setStoryPreview(true);
  }

  return {
    load,
    addGUI,
    markSceneReady,
    update: () => {
      if (!state.storyPreview) updateReadout();
    },
    refreshScroll: () => {
      if (state.storyPreview) ScrollTrigger.refresh();
    },
  };
}
