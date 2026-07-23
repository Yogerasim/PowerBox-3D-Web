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
  vignette: boolean;
  vignetteIntensity: number;
  vignetteSize: number;
  vignetteSoftness: number;
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
    randomness: number,
    phaseSpread: number,
    offLevel: number,
  ) => void;
  getSceneRotationY: () => number;
  setSceneRotationY: (value: number) => void;
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
const MOTION_STORAGE_KEY = "powerbox.scene-rotation.v3";
const MOBILE_QUERY = "(max-width: 760px), (pointer: coarse)";
const SHOT_IDS = [
  "control",
  "problem",
  "channels",
  "hero",
  "reliability",
  "contact",
] as const;

interface SceneRotationSettings {
  enabled: boolean;
  rangeDegrees: number;
  speedDegreesPerSecond: number;
}

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
    candidate.shots.length === SHOT_IDS.length &&
    candidate.shots.every((shot, index) => shot.id === SHOT_IDS[index]);
}

function migrateConfig(config: PresentationShotConfig): void {
  const migratePostFX = (postFX: PostFXState): void => {
    postFX.vignette ??= false;
    postFX.vignetteIntensity ??= 0.72;
    postFX.vignetteSize ??= 48;
    postFX.vignetteSoftness ??= 28;
  };

  config.shots.forEach((current) => {
    if (current.scene) {
      current.scene.yoke.settings.switchingPattern ??= "random";
      migratePostFX(current.scene.postFX);
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
      migratePostFX(current.mobileProfile.scene.postFX);
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
  let audio: HTMLAudioElement | null = null;
  let sceneRotationBase = 0;
  let sceneRotationStartedAt = performance.now();

  const state = {
    currentShot: SHOT_IDS[0] as string,
    storyMode: new URLSearchParams(location.search).get("story") === "1",
    showText: true,
    locale: "en" as Locale,
    editingProfile: "desktop" as DeviceProfile,
    transitionDuration: 0.85,
    performancePattern: "random" as SwitchingPattern,
    performanceSpeed: 2,
    performanceDuty: 0.5,
    performanceRandomness: 1,
    performancePhaseSpread: 0,
    performanceOffLevel: 0.35,
    sceneRotation: true,
    rotationRange: 360,
    rotationSpeed: 1.8,
    motionStatus: "Using project rotation defaults",
    status: "Loading shots…",
    audioEnabled: true,
    audioVolume: 0.3,
    audioStatus: "No loop configured",
  };

  function sceneRotationSnapshot(): SceneRotationSettings {
    return {
      enabled: state.sceneRotation,
      rangeDegrees: state.rotationRange,
      speedDegreesPerSecond: state.rotationSpeed,
    };
  }

  function restoreSceneRotation(): void {
    try {
      const saved = localStorage.getItem(MOTION_STORAGE_KEY);
      if (!saved) return;
      const motion = JSON.parse(saved) as Partial<SceneRotationSettings>;
      state.sceneRotation = motion.enabled ?? state.sceneRotation;
      state.rotationRange = motion.rangeDegrees ?? state.rotationRange;
      state.rotationSpeed =
        motion.speedDegreesPerSecond ?? state.rotationSpeed;
      state.motionStatus = "Saved scene rotation restored";
    } catch (error) {
      console.warn("[PowerBox] Scene rotation could not be restored", error);
      state.motionStatus = "Could not restore scene rotation";
    }
  }

  function saveSceneRotation(): void {
    localStorage.setItem(
      MOTION_STORAGE_KEY,
      JSON.stringify(sceneRotationSnapshot()),
    );
    state.motionStatus = "Scene rotation saved in this browser";
    console.info("[PowerBox] Scene rotation saved", sceneRotationSnapshot());
  }

  function downloadSceneRotation(): void {
    const blob = new Blob([JSON.stringify(sceneRotationSnapshot(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "powerbox-scene-rotation.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  restoreSceneRotation();

  const overlay = document.createElement("div");
  overlay.className = "presentation-overlay is-text-hidden";
  overlay.innerHTML = `
    <div class="presentation-scenes">
      <section class="presentation-scene scene-hero" data-shot="hero">
        <h1 data-copy="heroTitle">POWERBOX LIGHT INSTALL</h1>
        <h2><span data-copy="heroLeadA">Digital signal.</span> <strong data-copy="heroLeadB">Physical light.</strong></h2>
        <div class="scene-scroll-cue"><span></span><p data-copy="scroll">Scroll to explore</p></div>
        <p class="scene-description" data-copy="heroBody">An eight-channel controller that connects music, digital control and physical lights into one living system.</p>
      </section>
      <section class="presentation-scene scene-problem" data-shot="problem">
        <header><h1 data-copy="problemTitle">CLEARER SYSTEM</h1><h2><strong data-copy="problemLeadA">Light</strong> <span data-copy="problemLeadB">without chaos.</span></h2></header>
        <p class="scene-description" data-copy="problemBody">Eight power channels and real-time control are brought together in one device — without scattered relays, extension cords or improvised connections.</p>
        <p class="scene-footer" data-copy="problemFooter">One enclosure. One system. Complete control.</p>
      </section>
      <section class="presentation-scene scene-channels" data-shot="channels">
        <h1 data-copy="channelsTitle">LIVE CONTROL</h1>
        <div class="live-patterns" aria-label="Lighting patterns"></div>
        <div class="live-channels" aria-label="PowerBox channels"></div>
        <div class="live-sliders">
          <label data-control-label="speed"><span><b data-copy="speedLabel">Speed Hz</b> <output>2.00</output></span><input data-light-control="speed" type="range" min="0.05" max="20" step="0.01" value="2"></label>
          <label data-control-label="duty"><span><b data-copy="dutyLabel">On duration</b> <output>0.50</output></span><input data-light-control="duty" type="range" min="0.05" max="0.95" step="0.01" value="0.5"></label>
          <label data-control-label="phase"><span><b data-copy="phaseLabel">Phase spread</b> <output>0.00</output></span><input data-light-control="phase" type="range" min="0" max="1" step="0.01" value="0"></label>
          <label data-control-label="randomness"><span><b data-copy="randomLabel">Random timing</b> <output>1.00</output></span><input data-light-control="randomness" type="range" min="0" max="1" step="0.01" value="1"></label>
          <label data-control-label="off"><span><b data-copy="offLabel">Off level</b> <output>0.35</output></span><input data-light-control="off" type="range" min="0" max="1" step="0.01" value="0.35"></label>
        </div>
      </section>
      <section class="presentation-scene scene-control" data-shot="control">
        <h1 data-copy="controlTitle">MULTIPLE INPUTS</h1>
        <div class="scene-control-copy"><h2><strong data-copy="controlLeadA">One signal.</strong><br><strong data-copy="controlLeadB">Eight physical</strong> <span data-copy="controlLeadC">events.</span></h2><p data-copy="controlBody">PowerBox receives commands from TouchDesigner, Web UI, MIDI and UDP, turning digital data into an immediate lighting response.</p></div>
        <p class="scene-footer">TOUCHDESIGNER · MIDI · UDP · WEB CONTROL</p>
      </section>
      <section class="presentation-scene scene-reliability" data-shot="reliability">
        <header><h1 data-copy="insideTitle">ENGINEERED INSIDE</h1></header>
        <p class="scene-description" data-copy="insideBody">Each channel operates independently. Power distribution, control electronics and protection components are organised within one clear architecture.</p>
        <p class="scene-footer" data-copy="insideFooter">8 independent channels · 220 V · local control</p>
      </section>
      <section class="presentation-scene scene-contact" data-shot="contact">
        <h1 data-copy="contactTitle">START A PROJECT</h1>
        <h2><span data-copy="contactLeadA">Build your own</span> <strong data-copy="contactLeadB">lighting system.</strong></h2>
        <p class="scene-description" data-copy="contactBody">PowerBox can be adapted to your space, lighting fixtures and preferred control workflow.</p>
        <nav><a href="https://t.me/philip_gerasim" target="_blank" rel="noreferrer" data-copy="discuss">Discuss a project</a><a href="https://github.com/Yogerasim/PowerBox" target="_blank" rel="noreferrer"><span data-copy="specs">View specifications</span></a></nav>
      </section>
    </div>
    <div class="presentation-dots" aria-label="Presentation shots"></div>
  `;
  document.body.appendChild(overlay);

  const dots = overlay.querySelector<HTMLElement>(".presentation-dots")!;
  const scenes = Array.from(overlay.querySelectorAll<HTMLElement>(".presentation-scene"));
  const channels = overlay.querySelector<HTMLElement>(".live-channels")!;
  const patterns = overlay.querySelector<HTMLElement>(".live-patterns")!;
  const controls = {
    speed: overlay.querySelector<HTMLInputElement>("[data-light-control='speed']")!,
    duty: overlay.querySelector<HTMLInputElement>("[data-light-control='duty']")!,
    phase: overlay.querySelector<HTMLInputElement>("[data-light-control='phase']")!,
    randomness: overlay.querySelector<HTMLInputElement>("[data-light-control='randomness']")!,
    off: overlay.querySelector<HTMLInputElement>("[data-light-control='off']")!,
  };

  const copy: Record<Locale, Record<string, string>> = {
    en: {
      heroTitle: "POWERBOX LIGHT INSTALL",
      heroLeadA: "Digital signal.", heroLeadB: "Physical light.", scroll: "Scroll to explore",
      heroBody: "An eight-channel controller that connects music, digital control and physical lights into one living system.",
      problemLeadA: "Light", problemLeadB: "without chaos.",
      problemBody: "Eight power channels and real-time control are brought together in one device — without scattered relays, extension cords or improvised connections.",
      problemFooter: "One enclosure. One system. Complete control.",
      problemTitle: "CLEARER SYSTEM",
      channelsTitle: "LIVE CONTROL",
      randomPattern: "Random", circlePattern: "Circle", cracklePattern: "Crackle",
      speedLabel: "Speed Hz", dutyLabel: "On duration", phaseLabel: "Phase spread",
      randomLabel: "Random timing", offLabel: "Off level",
      controlTitle: "MULTIPLE INPUTS",
      controlLeadA: "One signal.", controlLeadB: "Eight physical", controlLeadC: "events.",
      controlBody: "PowerBox receives commands from TouchDesigner, Web UI, MIDI and UDP, turning digital data into an immediate lighting response.",
      insideBody: "Each channel operates independently. Power distribution, control electronics and protection components are organised within one clear architecture.",
      insideFooter: "8 independent channels · 220 V · local control",
      insideTitle: "ENGINEERED INSIDE",
      contactLeadA: "Build your own", contactLeadB: "lighting system.",
      contactBody: "PowerBox can be adapted to your space, lighting fixtures and preferred control workflow.",
      discuss: "Discuss a project", specs: "View specifications",
      contactTitle: "START A PROJECT",
    },
    ru: {
      heroTitle: "POWERBOX · СВЕТОВАЯ ИНСТАЛЛЯЦИЯ",
      heroLeadA: "Цифровой сигнал.", heroLeadB: "Физический свет.", scroll: "Листайте, чтобы исследовать",
      heroBody: "Восьмиканальный контроллер, который соединяет музыку, цифровое управление и реальные светильники в одну живую систему.",
      problemLeadA: "Свет", problemLeadB: "без хаоса.",
      problemBody: "Восемь каналов питания и управление в реальном времени собраны в одном устройстве — без россыпи реле, удлинителей и случайных соединений.",
      problemFooter: "Один корпус. Одна система. Полный контроль.",
      problemTitle: "ПОНЯТНАЯ СИСТЕМА",
      channelsTitle: "УПРАВЛЕНИЕ СВЕТОМ",
      randomPattern: "Случайно", circlePattern: "По кругу", cracklePattern: "Импульс",
      speedLabel: "Скорость, Гц", dutyLabel: "Длительность", phaseLabel: "Разброс фаз",
      randomLabel: "Случайный ритм", offLabel: "Уровень паузы",
      controlTitle: "СПОСОБЫ УПРАВЛЕНИЯ",
      controlLeadA: "Один сигнал.", controlLeadB: "Восемь физических", controlLeadC: "событий.",
      controlBody: "PowerBox принимает команды из TouchDesigner, Web UI, MIDI и по UDP, превращая цифровые данные в мгновенную реакцию света.",
      insideBody: "Каждый канал работает независимо. Силовая часть, управляющая электроника и защитные элементы организованы в одной понятной архитектуре.",
      insideFooter: "8 независимых каналов · 220 В · локальное управление",
      insideTitle: "ПРОДУМАНО ИЗНУТРИ",
      contactLeadA: "Соберите свою", contactLeadB: "световую систему.",
      contactBody: "PowerBox можно адаптировать под вашу сцену, светильники и выбранный способ управления.",
      discuss: "Обсудить проект", specs: "Характеристики",
      contactTitle: "НАЧАТЬ ПРОЕКТ",
    },
  };

  const patternLabels: Array<[SwitchingPattern, string]> = [
    ["random", "randomPattern"],
    ["chase", "circlePattern"],
    ["single", "cracklePattern"],
  ];

  function updateCopy(): void {
    overlay.querySelectorAll<HTMLElement>("[data-copy]").forEach((element) => {
      const key = element.dataset.copy!;
      element.textContent = copy[state.locale][key] ?? element.textContent;
    });
    patterns.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      const key = button.dataset.copy!;
      button.textContent = copy[state.locale][key] ?? button.textContent;
    });
    document.documentElement.lang = state.locale;
  }

  function syncControlDisplay(control: HTMLInputElement): void {
    const output = control.closest("label")?.querySelector("output");
    if (output) output.textContent = Number(control.value).toFixed(2);
    const min = Number(control.min);
    const max = Number(control.max);
    const percentage = ((Number(control.value) - min) / (max - min)) * 100;
    control.style.setProperty("--range-progress", `${percentage}%`);
  }

  function applyChannelStates(): void {
    channelStates.forEach((enabled, index) =>
      options.setInteractiveChannel(index, enabled));
  }

  function applyPerformanceControls(): void {
    options.setPerformanceControls(
      state.performancePattern,
      state.performanceSpeed,
      state.performanceDuty,
      state.performanceRandomness,
      state.performancePhaseSpread,
      state.performanceOffLevel,
    );
    applyChannelStates();
    patterns.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.pattern === state.performancePattern);
    });
    options.requestRender();
  }

  patternLabels.forEach(([pattern, copyKey]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = copy[state.locale][copyKey];
    button.dataset.copy = copyKey;
    button.dataset.pattern = pattern;
    button.addEventListener("click", () => {
      state.performancePattern = pattern;
      state.performanceRandomness = pattern === "random" ? 1 : 0;
      controls.randomness.value = String(state.performanceRandomness);
      syncControlDisplay(controls.randomness);
      applyPerformanceControls();
    });
    patterns.appendChild(button);
  });

  const sliderBindings: Array<[HTMLInputElement, keyof typeof state]> = [
    [controls.speed, "performanceSpeed"],
    [controls.duty, "performanceDuty"],
    [controls.phase, "performancePhaseSpread"],
    [controls.randomness, "performanceRandomness"],
    [controls.off, "performanceOffLevel"],
  ];
  sliderBindings.forEach(([control, key]) => {
    syncControlDisplay(control);
    control.addEventListener("input", () => {
      (state[key] as number) = Number(control.value);
      syncControlDisplay(control);
      applyPerformanceControls();
    });
  });

  for (let index = 0; index < 8; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `CH${index + 1}`;
    button.classList.add("is-active");
    button.addEventListener("click", () => {
      channelStates[index] = channelStates[index] === false ? null : false;
      options.setInteractiveChannel(index, channelStates[index]);
      button.classList.toggle("is-active", channelStates[index] !== false);
      button.setAttribute("aria-pressed", String(channelStates[index] !== false));
      options.requestRender();
    });
    button.setAttribute("aria-pressed", "true");
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

  function resetSceneRotation(preserveCurrent = false): void {
    if (!preserveCurrent) {
      options.setSceneRotationY(0);
    }
    sceneRotationBase = options.getSceneRotationY();
    sceneRotationStartedAt = performance.now();
    options.requestRender();
  }

  function updateSceneRotationSettings(): void {
    resetSceneRotation(state.sceneRotation);
  }

  function updateUI(): void {
    if (!config) return;
    const current = shot();
    state.currentShot = current.id;
    overlay.classList.toggle("is-text-hidden", !state.showText);
    scenes.forEach((scene, index) => {
      scene.classList.toggle("is-active", index === activeIndex);
    });
    dots.querySelectorAll("button").forEach((button, index) => {
      button.classList.toggle("is-active", index === activeIndex);
    });
    if (current.interactive) {
      applyPerformanceControls();
    } else {
      channelStates.fill(null);
      channelStates.forEach((_, index) => options.setInteractiveChannel(index, null));
      channels.querySelectorAll("button").forEach((button) => {
        button.classList.add("is-active");
        button.setAttribute("aria-pressed", "true");
      });
    }
    updateCopy();
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
      state.performanceRandomness = destinationScene.yoke.settings.randomness;
      state.performancePhaseSpread = destinationScene.yoke.settings.phaseSpread;
      state.performanceOffLevel = destinationScene.yoke.settings.offLevel;
      controls.speed.value = String(state.performanceSpeed);
      controls.duty.value = String(state.performanceDuty);
      controls.randomness.value = String(state.performanceRandomness);
      controls.phase.value = String(state.performancePhaseSpread);
      controls.off.value = String(state.performanceOffLevel);
      Object.values(controls).forEach(syncControlDisplay);
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
    resetSceneRotation(state.sceneRotation);
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
    const requestedLocale = new URLSearchParams(location.search).get("lang");
    state.locale = requestedLocale === "ru" || requestedLocale === "en"
      ? requestedLocale
      : value.defaultLocale;
    configureAudio(value.audio);
    const draft = isLocalEditor() ? localStorage.getItem(STORAGE_KEY) : null;
    if (draft) {
      const parsed = JSON.parse(draft) as unknown;
      if (isConfig(parsed)) config = parsed;
    }
    migrateConfig(config);
    rebuildDots();
    state.status = `${SHOT_IDS.length} independent shot states loaded`;
  }

  function addGUI(gui: GUI): void {
    const folder = gui.addFolder(`Shot editor · ${SHOT_IDS.length} views`);
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
    const motionFolder = folder.addFolder("Scene rotation");
    motionFolder
      .add(state, "sceneRotation")
      .name("Enabled")
      .onChange(updateSceneRotationSettings);
    motionFolder
      .add(state, "rotationRange", 1, 360, 1)
      .name("Rotation range °")
      .onChange(updateSceneRotationSettings);
    motionFolder
      .add(state, "rotationSpeed", 0.01, 10, 0.01)
      .name("Speed °/sec")
      .onChange(updateSceneRotationSettings);
    motionFolder
      .add({ save: saveSceneRotation }, "save")
      .name("Save scene rotation");
    motionFolder
      .add({ download: downloadSceneRotation }, "download")
      .name("Download rotation JSON");
    motionFolder
      .add(state, "motionStatus")
      .name("Settings")
      .listen()
      .disable();
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
        !state.sceneRotation ||
        transition?.isActive()
      ) {
        return;
      }

      const elapsedSeconds =
        (performance.now() - sceneRotationStartedAt) * 0.001;
      const angularSpeed = MathUtils.degToRad(state.rotationSpeed);
      let angle = sceneRotationBase;

      if (state.rotationRange >= 359.5) {
        angle += elapsedSeconds * angularSpeed;
      } else {
        const amplitude = MathUtils.degToRad(state.rotationRange * 0.5);
        const phase = elapsedSeconds * angularSpeed /
          Math.max(amplitude, 0.0001);
        angle += amplitude * Math.sin(phase);
      }

      options.setSceneRotationY(angle);
    },
    refresh: () => sceneReady && goTo(activeIndex, false),
  };
}
