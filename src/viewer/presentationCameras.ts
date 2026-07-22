import type GUI from "lil-gui";
import { MathUtils, OrthographicCamera, Vector3 } from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { gsap } from "gsap";
import type {
  SwitchingPattern,
  YokeLightState,
} from "./yokeLights";

export type Locale = "ru" | "en";

export interface PostFXState {
  bloom: boolean;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  depthOfField: boolean;
  autoFocus: boolean;
  focusDistance: number;
  aperture: number;
  maxBlur: number;
}

export interface SceneState {
  exposure: number;
  environment: number;
  shadows: boolean;
  postFX: PostFXState;
  yoke: YokeLightState;
}

export interface ResponsiveFraming {
  zoomMultiplier: number;
  targetOffset: [number, number, number];
}

export type DeviceProfile = "desktop" | "mobile";

export interface ShotProfile {
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    zoom: number;
    orthographicHeight: number;
  };
  scene: SceneState | null;
}

export interface PresentationShot {
  id: string;
  label: Record<Locale, string>;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    zoom: number;
    orthographicHeight: number;
    desktop: ResponsiveFraming;
    mobile: ResponsiveFraming;
  };
  scene: SceneState | null;
  mobileProfile?: ShotProfile;
  interactive: boolean;
}

export interface PresentationShotConfig {
  version: 2;
  defaultLocale: Locale;
  audio?: {
    url: string | null;
    autoplay: boolean;
    loop: boolean;
    volume: number;
  };
  shots: PresentationShot[];
}

interface Options {
  camera: OrthographicCamera;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
  getOrthographicHeight: () => number;
  setOrthographicHeight: (value: number) => void;
  updateProjection: () => void;
  getSceneState: () => SceneState;
  applySceneState: (state: SceneState) => void;
  setInteractiveChannel: (index: number, enabled: boolean | null) => void;
  setPerformanceControls: (
    pattern: SwitchingPattern,
    speedHz: number,
    dutyCycle: number,
  ) => void;
  requestRender: () => void;
}

export interface PresentationCameraSystem {
  load: () => Promise<void>;
  addGUI: (gui: GUI) => void;
  markSceneReady: () => void;
  update: () => void;
  refresh: () => void;
}

const CONFIG_URL = `${import.meta.env.BASE_URL}config/presentation-shots.json`;
const STORAGE_KEY = "powerbox.presentation-shots.v2";
const MOBILE_QUERY = "(max-width: 760px), (pointer: coarse)";

function isLocalEditor(): boolean {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function tuple(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z].map((value) =>
    Number(value.toFixed(6))) as [number, number, number];
}

function isConfig(value: unknown): value is PresentationShotConfig {
  const candidate = value as Partial<PresentationShotConfig>;
  return typeof value === "object" && value !== null &&
    candidate.version === 2 && Array.isArray(candidate.shots) &&
    candidate.shots.length === 7;
}

function migrateConfig(config: PresentationShotConfig): void {
  config.shots.forEach((current) => {
    if (current.scene) {
      current.scene.yoke.settings.switchingPattern ??= "random";
    }

    if (!current.mobileProfile) {
      const mobileFraming = current.camera.mobile;
      current.mobileProfile = {
        camera: {
          position: structuredClone(current.camera.position),
          target: [
            current.camera.target[0] + mobileFraming.targetOffset[0],
            current.camera.target[1] + mobileFraming.targetOffset[1],
            current.camera.target[2] + mobileFraming.targetOffset[2],
          ],
          zoom: current.camera.zoom * mobileFraming.zoomMultiplier,
          orthographicHeight: current.camera.orthographicHeight,
        },
        scene: current.scene ? structuredClone(current.scene) : null,
      };
    }

    if (current.mobileProfile.scene) {
      current.mobileProfile.scene.yoke.settings.switchingPattern ??= "random";
    }
  });
}

function downloadConfig(config: PresentationShotConfig): void {
  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "powerbox-presentation-shots.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createPresentationCameraSystem(options: Options): PresentationCameraSystem {
  let config: PresentationShotConfig | null = null;
  let committedConfig: PresentationShotConfig | null = null;
  let sceneReady = false;
  let activeIndex = 0;
  let transition: gsap.core.Timeline | null = null;
  let wheelLocked = false;
  let touchStartY = 0;
  let touchStartX = 0;
  const channelStates: Array<boolean | null> =
    Array.from({ length: 8 }, () => null);
  let manualChannels = false;
  let audio: HTMLAudioElement | null = null;
  const driftBasePosition = new Vector3();
  const driftBaseTarget = new Vector3();
  const driftOffset = new Vector3();
  const driftAxis = new Vector3(0, 1, 0);
  let driftStartedAt = performance.now();

  const state = {
    currentShot: "hero",
    storyMode: new URLSearchParams(location.search).get("story") === "1",
    showText: false,
    locale: "ru" as Locale,
    editingProfile: "desktop" as DeviceProfile,
    transitionDuration: 0.85,
    performancePattern: "random" as SwitchingPattern,
    performanceSpeed: 2,
    performanceDuty: 0.5,
    cameraDrift: true,
    driftAmount: 1,
    driftCycle: 24,
    status: "Loading shots…",
    audioEnabled: true,
    audioVolume: 0.3,
    audioStatus: "No loop configured",
  };

  const overlay = document.createElement("div");
  overlay.className = "presentation-overlay is-text-hidden";
  overlay.innerHTML = `
    <div class="presentation-shot-label" aria-live="polite"></div>
    <div class="presentation-dots" aria-label="Presentation shots"></div>
    <div class="presentation-interaction" aria-label="PowerBox interactive lighting">
      <div class="presentation-patterns" aria-label="Lighting patterns"></div>
      <label>Speed <input data-light-control="speed" type="range" min="0.05" max="12" step="0.05" value="2"></label>
      <label>On time <input data-light-control="duty" type="range" min="0.05" max="0.95" step="0.01" value="0.5"></label>
      <div class="presentation-channels" aria-label="PowerBox channels"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const label = overlay.querySelector<HTMLElement>(".presentation-shot-label")!;
  const dots = overlay.querySelector<HTMLElement>(".presentation-dots")!;
  const channels = overlay.querySelector<HTMLElement>(".presentation-channels")!;
  const interaction = overlay.querySelector<HTMLElement>(".presentation-interaction")!;
  const patterns = overlay.querySelector<HTMLElement>(".presentation-patterns")!;
  const speedControl = overlay.querySelector<HTMLInputElement>("[data-light-control='speed']")!;
  const dutyControl = overlay.querySelector<HTMLInputElement>("[data-light-control='duty']")!;

  const patternLabels: Array<[SwitchingPattern, string]> = [
    ["chase", "Circle"],
    ["random", "Random"],
    ["single", "Crackle"],
  ];

  function applyPerformanceControls(): void {
    manualChannels = false;
    channelStates.fill(null);
    options.setPerformanceControls(
      state.performancePattern,
      state.performanceSpeed,
      state.performanceDuty,
    );
    patterns.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.dataset.pattern === state.performancePattern,
      );
    });
    channels.querySelectorAll("button").forEach((button) =>
      button.classList.remove("is-active"));
    options.requestRender();
  }

  patternLabels.forEach(([pattern, title]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = title;
    button.dataset.pattern = pattern;
    button.addEventListener("click", () => {
      state.performancePattern = pattern;
      applyPerformanceControls();
    });
    patterns.appendChild(button);
  });

  speedControl.addEventListener("input", () => {
    state.performanceSpeed = Number(speedControl.value);
    applyPerformanceControls();
  });

  dutyControl.addEventListener("input", () => {
    state.performanceDuty = Number(dutyControl.value);
    applyPerformanceControls();
  });

  for (let index = 0; index < 8; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `CH${index + 1}`;
    button.addEventListener("click", () => {
      manualChannels = true;
      channelStates[index] = channelStates[index] === true ? false : true;
      channelStates.forEach((enabled, channelIndex) =>
        options.setInteractiveChannel(channelIndex, enabled));
      button.classList.toggle("is-active", channelStates[index] === true);
      options.requestRender();
    });
    channels.appendChild(button);
  }

  function mobile(): boolean {
    return matchMedia(MOBILE_QUERY).matches;
  }

  function shot(): PresentationShot {
    if (!config) throw new Error("Presentation shots are not loaded.");
    return config.shots[activeIndex];
  }

  function framing(current: PresentationShot): ResponsiveFraming {
    return current.camera.desktop;
  }

  function selectedProfile(): DeviceProfile {
    return state.storyMode
      ? (mobile() ? "mobile" : "desktop")
      : state.editingProfile;
  }

  function profile(current: PresentationShot): ShotProfile {
    if (selectedProfile() === "mobile" && current.mobileProfile) {
      return current.mobileProfile;
    }

    const desktopFraming = framing(current);
    return {
      camera: {
        position: current.camera.position,
        target: [
          current.camera.target[0] + desktopFraming.targetOffset[0],
          current.camera.target[1] + desktopFraming.targetOffset[1],
          current.camera.target[2] + desktopFraming.targetOffset[2],
        ],
        zoom: current.camera.zoom * desktopFraming.zoomMultiplier,
        orthographicHeight: current.camera.orthographicHeight,
      },
      scene: current.scene,
    };
  }

  function cameraTarget(current: PresentationShot): Vector3 {
    return new Vector3(...profile(current).camera.target);
  }

  function resetCameraDrift(): void {
    driftBasePosition.copy(options.camera.position);
    driftBaseTarget.copy(options.controls.target);
    driftStartedAt = performance.now();
  }

  function updateUI(): void {
    if (!config) return;
    const current = shot();
    state.currentShot = current.id;
    label.textContent = current.label[state.locale];
    overlay.classList.toggle("is-text-hidden", !state.showText);
    interaction.classList.toggle("is-visible", current.interactive);
    dots.querySelectorAll("button").forEach((button, index) => {
      button.classList.toggle("is-active", index === activeIndex);
    });
    if (current.interactive) {
      if (manualChannels) {
        channelStates.forEach((enabled, index) =>
          options.setInteractiveChannel(index, enabled));
      } else {
        applyPerformanceControls();
      }
    } else {
      channelStates.fill(null);
      channelStates.forEach((_, index) => options.setInteractiveChannel(index, null));
      channels.querySelectorAll("button").forEach((button) =>
        button.classList.remove("is-active"));
    }
  }

  function applyImmediate(current: PresentationShot): void {
    transition?.kill();
    const currentProfile = profile(current);
    options.camera.position.fromArray(currentProfile.camera.position);
    options.controls.target.copy(cameraTarget(current));
    options.camera.zoom = currentProfile.camera.zoom;
    options.setOrthographicHeight(currentProfile.camera.orthographicHeight);
    if (currentProfile.scene) {
      options.applySceneState(structuredClone(currentProfile.scene));
    }
    options.updateProjection();
    options.controls.update();
    resetCameraDrift();
    options.requestRender();
    updateUI();
  }

  function goTo(index: number, animate = true): void {
    if (!config || !sceneReady) return;
    const next = MathUtils.clamp(index, 0, config.shots.length - 1);
    if (next === activeIndex && animate) return;
    activeIndex = next;
    const current = shot();
    const currentProfile = profile(current);
    const target = cameraTarget(current);
    const targetProxy = options.controls.target.clone();
    const destinationScene = currentProfile.scene
      ? structuredClone(currentProfile.scene)
      : options.getSceneState();

    if (current.interactive) {
      state.performancePattern = destinationScene.yoke.settings.switchingPattern;
      state.performanceSpeed = destinationScene.yoke.settings.switchingSpeedHz;
      state.performanceDuty = destinationScene.yoke.settings.dutyCycle;
      speedControl.value = String(state.performanceSpeed);
      dutyControl.value = String(state.performanceDuty);
      manualChannels = false;
    }
    transition?.kill();

    if (!animate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      applyImmediate(current);
      return;
    }

    const duration = state.transitionDuration;
    transition = gsap.timeline({
      defaults: { duration, ease: "power2.inOut", overwrite: true },
      onStart: () => options.controls.enabled = false,
      onComplete: () => {
        options.applySceneState(destinationScene);
        options.controls.enabled = !state.storyMode && !mobile();
        resetCameraDrift();
        updateUI();
        options.requestRender();
      },
    });
    transition.to(options.camera.position, {
      x: currentProfile.camera.position[0],
      y: currentProfile.camera.position[1],
      z: currentProfile.camera.position[2],
    }, 0).to(targetProxy, {
      x: target.x, y: target.y, z: target.z,
      onUpdate: () => options.controls.target.copy(targetProxy),
    }, 0).to(options.camera, {
      zoom: currentProfile.camera.zoom,
      onUpdate: () => {
        options.updateProjection();
        options.requestRender();
      },
    }, 0);
    options.setOrthographicHeight(currentProfile.camera.orthographicHeight);
    options.applySceneState(destinationScene);
    updateUI();
  }

  function navigate(delta: number): void {
    if (!state.storyMode || transition?.isActive()) return;
    goTo(activeIndex + delta);
  }

  function setStoryMode(enabled: boolean): void {
    state.storyMode = enabled;
    document.documentElement.classList.toggle("presentation-story-mode", enabled);
    document.body.classList.toggle("presentation-story-mode", enabled);
    overlay.classList.add("is-visible");
    overlay.classList.toggle("is-editor", !enabled);
    options.controls.enabled = !enabled && !mobile();
    options.controls.enableZoom = !mobile() && !enabled;
    options.canvas.style.touchAction = enabled || mobile() ? "none" : "auto";
    if (sceneReady) goTo(activeIndex, false);
  }

  function captureCurrent(): void {
    if (!config) return;
    const current = shot();
    const captured: ShotProfile = {
      camera: {
        position: tuple(options.camera.position),
        target: tuple(options.controls.target),
        zoom: Number(options.camera.zoom.toFixed(6)),
        orthographicHeight: Number(options.getOrthographicHeight().toFixed(6)),
      },
      scene: structuredClone(options.getSceneState()),
    };

    if (state.editingProfile === "mobile") {
      current.mobileProfile = captured;
    } else {
      current.camera.position = captured.camera.position;
      current.camera.target = captured.camera.target;
      current.camera.zoom = captured.camera.zoom;
      current.camera.orthographicHeight = captured.camera.orthographicHeight;
      current.camera.desktop = {
        zoomMultiplier: 1,
        targetOffset: [0, 0, 0],
      };
      current.scene = captured.scene;
    }
    saveDraft();
    state.status = `Saved ${state.editingProfile}: ${current.id}`;
    options.requestRender();
    console.info("[PowerBox] Full shot state captured", current);
  }

  function saveDraft(): void {
    if (config && isLocalEditor()) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
  }

  function rebuildDots(): void {
    if (!config) return;
    dots.replaceChildren();
    config.shots.forEach((current, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.ariaLabel = current.label[state.locale];
      button.addEventListener("click", () => goTo(index));
      dots.appendChild(button);
    });
    updateUI();
  }

  function configureAudio(audioConfig: PresentationShotConfig["audio"]): void {
    if (!audioConfig?.url) {
      state.audioStatus = "Add a 5–10 sec loop in config";
      return;
    }

    audio = new Audio(`${import.meta.env.BASE_URL}${audioConfig.url}`);
    audio.loop = audioConfig.loop;
    audio.volume = audioConfig.volume;
    audio.preload = "auto";
    state.audioVolume = audioConfig.volume;

    const start = async (): Promise<void> => {
      if (!audio || !state.audioEnabled) return;

      try {
        await audio.play();
        state.audioStatus = "Loop playing";
      } catch {
        state.audioStatus = "Tap once to start audio";
      }
    };

    if (audioConfig.autoplay) void start();
    window.addEventListener("pointerdown", () => void start(), { once: true });
  }

  async function load(): Promise<void> {
    const response = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Shot config request failed: ${response.status}`);
    const value = await response.json() as unknown;
    if (!isConfig(value)) throw new Error("presentation-shots.json has an invalid format.");
    committedConfig = structuredClone(value);
    config = structuredClone(value);
    state.locale = value.defaultLocale;
    configureAudio(value.audio);
    const draft = isLocalEditor() ? localStorage.getItem(STORAGE_KEY) : null;
    if (draft) {
      const parsed = JSON.parse(draft) as unknown;
      if (isConfig(parsed)) config = parsed;
    }
    migrateConfig(config);
    rebuildDots();
    state.status = "Seven independent shot states loaded";
  }

  function addGUI(gui: GUI): void {
    const folder = gui.addFolder("Shot editor · 7 views");
    const shotMap = Object.fromEntries((config?.shots ?? []).map((item, index) =>
      [`${index + 1} · ${item.label[state.locale]}`, item.id]));
    folder.add(state, "currentShot", shotMap).name("Current shot").listen().onChange((id: string) => {
      const index = config?.shots.findIndex((item) => item.id === id) ?? 0;
      goTo(index);
    });
    folder
      .add(state, "editingProfile", {
        "Desktop profile": "desktop",
        "Mobile profile": "mobile",
      })
      .name("Editing profile")
      .listen()
      .onChange(() => goTo(activeIndex, false));
    folder.add(state, "storyMode").name("Story mode").onChange(setStoryMode);
    folder.add(state, "showText").name("Text overlay").onChange(updateUI);
    folder.add(state, "locale", { Русский: "ru", English: "en" }).name("Language").onChange(() => {
      rebuildDots();
      updateUI();
    });
    folder.add(state, "transitionDuration", 0.2, 2, 0.05).name("Transition seconds");
    folder.add(state, "cameraDrift").name("Camera idle drift");
    folder.add(state, "driftAmount", 0, 3, 0.05).name("Drift amount °");
    folder.add(state, "driftCycle", 8, 60, 1).name("Drift cycle sec");
    folder.add({ save: captureCurrent }, "save").name("Save full shot state");
    folder.add({ preview: () => goTo(activeIndex, false) }, "preview").name("Apply current shot");
    folder.add({ previous: () => goTo(activeIndex - 1) }, "previous").name("Previous shot");
    folder.add({ next: () => goTo(activeIndex + 1) }, "next").name("Next shot");
    folder.add({ download: () => config && downloadConfig(config) }, "download").name("Download shots JSON");
    folder.add({ reset: () => {
      if (!committedConfig) return;
      config = structuredClone(committedConfig);
      migrateConfig(config);
      config.shots.forEach((current) => {
        current.scene ??= structuredClone(options.getSceneState());
        if (current.mobileProfile) {
          current.mobileProfile.scene ??= structuredClone(current.scene);
        }
      });
      localStorage.removeItem(STORAGE_KEY);
      activeIndex = 0;
      rebuildDots();
      goTo(0, false);
    } }, "reset").name("Reset local draft");
    folder.add(state, "status").name("Status").listen().disable();

    const audioFolder = folder.addFolder("Audio loop · prepared");
    audioFolder
      .add(state, "audioEnabled")
      .name("Enabled")
      .onChange((enabled: boolean) => {
        if (!audio) return;
        if (enabled) {
          void audio.play();
        } else {
          audio.pause();
        }
      });
    audioFolder
      .add(state, "audioVolume", 0, 1, 0.01)
      .name("Volume")
      .onChange((volume: number) => {
        if (audio) audio.volume = volume;
      });
    audioFolder.add(state, "audioStatus").name("Status").listen().disable();
    audioFolder.close();
  }

  window.addEventListener("wheel", (event) => {
    if (!state.storyMode || mobile() || wheelLocked || Math.abs(event.deltaY) < 8) return;
    event.preventDefault();
    wheelLocked = true;
    navigate(event.deltaY > 0 ? 1 : -1);
    window.setTimeout(() => wheelLocked = false, 650);
  }, { passive: false });

  window.addEventListener("touchstart", (event) => {
    if (!state.storyMode || event.touches.length !== 1) return;
    touchStartY = event.touches[0].clientY;
    touchStartX = event.touches[0].clientX;
  }, { passive: true });

  window.addEventListener("touchend", (event) => {
    if (!state.storyMode || event.changedTouches.length !== 1) return;
    const deltaY = touchStartY - event.changedTouches[0].clientY;
    const deltaX = touchStartX - event.changedTouches[0].clientX;
    if (Math.abs(deltaY) > 48 && Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
      navigate(deltaY > 0 ? 1 : -1);
    }
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (sceneReady) setStoryMode(state.storyMode);
  });

  return {
    load,
    addGUI,
    markSceneReady: () => {
      sceneReady = true;
      // Scene Lab applies the authored GUI preset after the camera file is
      // loaded. Camera-only legacy shots must inherit that final state here,
      // rather than constructor defaults captured too early during startup.
      config?.shots.forEach((current) => {
        current.scene ??= structuredClone(options.getSceneState());
        if (current.mobileProfile) {
          current.mobileProfile.scene ??= structuredClone(current.scene);
        }
      });
      state.editingProfile = mobile() ? "mobile" : "desktop";
      options.canvas.classList.remove("is-loading");
      setStoryMode(state.storyMode);
      goTo(activeIndex, false);
    },
    update: () => {
      if (
        !sceneReady ||
        !state.storyMode ||
        !state.cameraDrift ||
        transition?.isActive()
      ) {
        return;
      }

      const elapsedSeconds = (performance.now() - driftStartedAt) * 0.001;
      const phase = elapsedSeconds / Math.max(state.driftCycle, 1) * Math.PI * 2;
      const angle = MathUtils.degToRad(state.driftAmount) * Math.sin(phase);

      driftOffset
        .copy(driftBasePosition)
        .sub(driftBaseTarget)
        .applyAxisAngle(driftAxis, angle);
      options.camera.position.copy(driftBaseTarget).add(driftOffset);
      options.controls.target.copy(driftBaseTarget);
      options.camera.lookAt(driftBaseTarget);
    },
    refresh: () => sceneReady && goTo(activeIndex, false),
  };
}
