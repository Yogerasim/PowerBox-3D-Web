import type GUI from "lil-gui";
import {
  Color,
  Group,
  MathUtils,
  Quaternion,
  RectAreaLight,
} from "three";
import { RectAreaLightHelper } from "three/addons/helpers/RectAreaLightHelper.js";
import {
  YOKE_AREA_LIGHTS,
  type YokeAreaLightConfig,
} from "./yokeLightConfig";

interface PerLightSettings {
  enabled: boolean;
  gain: number;
  phase: number;
}

interface YokeLightSettings {
  enabled: boolean;
  energyWatts: number;
  webCalibration: number;
  brightness: number;
  color: string;
  width: number;
  height: number;
  showHelpers: boolean;
  flicker: boolean;
  flickerSpeedHz: number;
  flickerDepth: number;
  randomness: number;
  phaseSpread: number;
  minimumBrightness: number;
}

export interface YokeLightRig {
  root: Group;
  addGUI: (gui: GUI) => void;
  update: (timeSeconds: number) => void;
}

interface RuntimeYokeLight {
  config: YokeAreaLightConfig;
  light: RectAreaLight;
  helper: RectAreaLightHelper;
  settings: PerLightSettings;
  seed: number;
}

const DEFAULT_EFFECTIVE_WIDTH = 1.0 * 0.16;
const DEFAULT_EFFECTIVE_HEIGHT = 0.25 * 2.14;
const DEFAULT_WEB_CALIBRATION = 0.02;

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash(value: number): number {
  return fract(
    Math.sin(value * 12.9898 + 78.233) * 43758.5453123,
  );
}

function smoothNoise(
  value: number,
  seed: number,
): number {
  const integer = Math.floor(value);
  const fraction = value - integer;
  const smooth = fraction * fraction * (3 - 2 * fraction);

  return MathUtils.lerp(
    hash(integer + seed * 17.17),
    hash(integer + 1 + seed * 17.17),
    smooth,
  );
}

function flickerSignal(
  timeSeconds: number,
  index: number,
  runtime: RuntimeYokeLight,
  settings: YokeLightSettings,
): number {
  if (!settings.flicker || settings.flickerDepth <= 0) {
    return 1;
  }

  const phase =
    runtime.settings.phase *
    settings.phaseSpread *
    Math.PI *
    2;

  const sine =
    0.5 +
    0.5 *
      Math.sin(
        timeSeconds *
          settings.flickerSpeedHz *
          Math.PI *
          2 +
          phase,
      );

  const noise = smoothNoise(
    timeSeconds *
      settings.flickerSpeedHz *
      1.37 +
      index * 3.71,
    runtime.seed,
  );

  const mixed = MathUtils.lerp(
    sine,
    noise,
    settings.randomness,
  );

  const shaped = Math.max(
    settings.minimumBrightness,
    mixed,
  );

  return MathUtils.lerp(
    1,
    shaped,
    settings.flickerDepth,
  );
}

function applyTransform(
  light: RectAreaLight,
  config: YokeAreaLightConfig,
): void {
  light.position.set(
    config.position[0],
    config.position[1],
    config.position[2],
  );

  light.quaternion.copy(
    new Quaternion(
      config.quaternionXYZW[0],
      config.quaternionXYZW[1],
      config.quaternionXYZW[2],
      config.quaternionXYZW[3],
    ).normalize(),
  );

  light.scale.set(1, 1, 1);
  light.updateMatrix();
  light.updateMatrixWorld(true);
}

function createRuntimeLight(
  config: YokeAreaLightConfig,
  index: number,
  settings: YokeLightSettings,
): RuntimeYokeLight {
  const color = new Color(
    config.colorLinearRGB[0],
    config.colorLinearRGB[1],
    config.colorLinearRGB[2],
  );

  const light = new RectAreaLight(
    color,
    config.energyWatts * DEFAULT_WEB_CALIBRATION,
    settings.width,
    settings.height,
  );

  light.name = `YOKE_WEB__${config.name}`;
  light.userData.blenderObject = config.name;
  light.userData.blenderEnergyWatts = config.energyWatts;
  light.userData.sourceDirectionMinusZ = [
    ...config.directionMinusZ,
  ];

  applyTransform(light, config);

  const helper = new RectAreaLightHelper(light);
  helper.name = `YOKE_HELPER__${config.name}`;
  helper.visible = settings.showHelpers;

  return {
    config,
    light,
    helper,
    settings: {
      enabled: true,
      gain: 1,
      phase: index / YOKE_AREA_LIGHTS.length,
    },
    seed: 100 + index * 19,
  };
}

export function createYokeLightRig(): YokeLightRig {
  const root = new Group();
  root.name = "YOKE_AREA_LIGHTS_WEB";

  const lightGroup = new Group();
  lightGroup.name = "YOKE_AREA_LIGHTS";

  root.add(lightGroup);

  const settings: YokeLightSettings = {
    enabled: true,
    energyWatts: 10,
    webCalibration: DEFAULT_WEB_CALIBRATION,
    brightness: 1,
    color: "#ffffff",
    width: DEFAULT_EFFECTIVE_WIDTH,
    height: DEFAULT_EFFECTIVE_HEIGHT,
    showHelpers: false,
    flicker: false,
    flickerSpeedHz: 2,
    flickerDepth: 0.85,
    randomness: 0.3,
    phaseSpread: 1,
    minimumBrightness: 0.03,
  };

  const runtimeLights = YOKE_AREA_LIGHTS.map(
    (config, index) =>
      createRuntimeLight(config, index, settings),
  );

  for (const runtime of runtimeLights) {
    runtime.light.add(runtime.helper);
    lightGroup.add(runtime.light);
  }

  function syncStaticSettings(): void {
    const color = new Color(settings.color);

    root.visible = settings.enabled;

    for (const runtime of runtimeLights) {
      runtime.light.color.copy(color);
      runtime.light.width = settings.width;
      runtime.light.height = settings.height;
      runtime.helper.visible = settings.showHelpers;
      runtime.helper.updateMatrixWorld(true);
    }
  }

  function addGUI(gui: GUI): void {
    const folder = gui.addFolder("Yoke Area Lights");

    folder
      .add(settings, "enabled")
      .name("Enabled")
      .onChange(syncStaticSettings);

    folder
      .add(settings, "energyWatts", 0, 100, 0.1)
      .name("Blender energy W");

    folder
      .add(
        settings,
        "webCalibration",
        0,
        0.2,
        0.001,
      )
      .name("Web calibration");

    folder
      .add(settings, "brightness", 0, 20, 0.01)
      .name("Master brightness");

    folder
      .addColor(settings, "color")
      .name("Color")
      .onChange(syncStaticSettings);

    const shapeFolder = folder.addFolder("Area shape");

    shapeFolder
      .add(settings, "width", 0.02, 2, 0.01)
      .name("Width m")
      .onChange(syncStaticSettings);

    shapeFolder
      .add(settings, "height", 0.02, 2, 0.01)
      .name("Height m")
      .onChange(syncStaticSettings);

    shapeFolder
      .add(settings, "showHelpers")
      .name("Show helpers")
      .onChange(syncStaticSettings);

    const flickerFolder = folder.addFolder("Flicker");

    flickerFolder
      .add(settings, "flicker")
      .name("Enabled");

    flickerFolder
      .add(
        settings,
        "flickerSpeedHz",
        0.05,
        20,
        0.01,
      )
      .name("Speed Hz");

    flickerFolder
      .add(settings, "flickerDepth", 0, 1, 0.01)
      .name("Depth");

    flickerFolder
      .add(settings, "randomness", 0, 1, 0.01)
      .name("Randomness");

    flickerFolder
      .add(settings, "phaseSpread", 0, 1, 0.01)
      .name("Phase spread");

    flickerFolder
      .add(
        settings,
        "minimumBrightness",
        0,
        1,
        0.01,
      )
      .name("Minimum");

    const individualFolder = folder.addFolder(
      "Individual lights",
    );

    runtimeLights.forEach((runtime, index) => {
      const itemFolder = individualFolder.addFolder(
        `${index + 1} · ${runtime.config.name}`,
      );

      itemFolder
        .add(runtime.settings, "enabled")
        .name("Enabled");

      itemFolder
        .add(runtime.settings, "gain", 0, 3, 0.01)
        .name("Gain");

      itemFolder
        .add(runtime.settings, "phase", 0, 1, 0.01)
        .name("Phase");
    });

    syncStaticSettings();
  }

  function update(timeSeconds: number): void {
    if (!settings.enabled) {
      return;
    }

    const baseIntensity =
      settings.energyWatts *
      settings.webCalibration *
      settings.brightness;

    runtimeLights.forEach((runtime, index) => {
      const enabled = runtime.settings.enabled;

      runtime.light.visible = enabled;

      if (!enabled) {
        runtime.light.intensity = 0;
        return;
      }

      const modulation = flickerSignal(
        timeSeconds,
        index,
        runtime,
        settings,
      );

      runtime.light.intensity =
        baseIntensity *
        runtime.settings.gain *
        modulation;
    });
  }

  syncStaticSettings();

  return {
    root,
    addGUI,
    update,
  };
}
