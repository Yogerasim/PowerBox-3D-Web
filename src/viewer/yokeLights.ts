import type GUI from "lil-gui";
import {
  Color,
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  SpotLight,
  SpotLightHelper,
  Vector3,
} from "three";
import {
  YOKE_AREA_LIGHTS,
  type YokeAreaLightConfig,
} from "./yokeLightConfig";

type EmissiveMaterial =
  | MeshStandardMaterial
  | MeshPhysicalMaterial;

interface PerLightSettings {
  enabled: boolean;
  gain: number;
  phase: number;

  positionX: number;
  positionY: number;
  positionZ: number;

  rotationX: number;
  rotationY: number;
  rotationZ: number;

  angleOffset: number;
  penumbraOffset: number;
}

interface YokeLightSettings {
  enabled: boolean;

  energyWatts: number;
  webCalibration: number;
  brightness: number;
  color: string;

  aimAtTarget: boolean;
  targetX: number;
  targetY: number;
  targetZ: number;
  targetDistance: number;

  rotationX: number;
  rotationY: number;
  rotationZ: number;

  distance: number;
  coneAngleDegrees: number;
  penumbra: number;
  decay: number;

  castShadows: boolean;
  shadowBias: number;
  shadowNormalBias: number;

  showHelpers: boolean;

  panelGlow: number;
  indicatorGlow: number;
  indicatorColor: string;

  switching: boolean;
  switchingSpeedHz: number;
  dutyCycle: number;
  randomness: number;
  phaseSpread: number;
  offLevel: number;
}

export interface YokeLightRig {
  root: Group;
  addGUI: (gui: GUI) => void;
  update: (timeSeconds: number) => void;
  registerLedLightRoot: (root: Object3D) => void;
}

interface EmissiveBinding {
  material: EmissiveMaterial;
  runtimeIndex: number;
}

interface IndicatorBinding {
  material: EmissiveMaterial;
}

interface RuntimeYokeLight {
  config: YokeAreaLightConfig;
  light: SpotLight;
  helper: SpotLightHelper;
  settings: PerLightSettings;
  seed: number;
}

const DIFFUSER_MATERIAL_NAME =
  "led_diffuser_emissive_strip";

const INDICATOR_MATERIAL_NAME =
  "powerbox_signal_orange";

function normalizeMaterialName(name: string): string {
  return name
    .replace(/__YOKE_\d+$/i, "")
    .replace(/\.\d{3}$/i, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isNamedMaterial(
  material: EmissiveMaterial,
  expectedName: string,
): boolean {
  return (
    normalizeMaterialName(material.name) ===
    normalizeMaterialName(expectedName)
  );
}

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

function hardSwitchSignal(
  timeSeconds: number,
  index: number,
  runtime: RuntimeYokeLight,
  settings: YokeLightSettings,
): number {
  if (!settings.switching) {
    return 1;
  }

  const phase =
    runtime.settings.phase *
    settings.phaseSpread *
    Math.PI *
    2;

  const periodicSignal =
    0.5 +
    0.5 *
      Math.sin(
        timeSeconds *
          settings.switchingSpeedHz *
          Math.PI *
          2 +
          phase,
      );

  const randomSignal = smoothNoise(
    timeSeconds *
      settings.switchingSpeedHz *
      1.37 +
      index * 3.71,
    runtime.seed,
  );

  const timingSignal = MathUtils.lerp(
    periodicSignal,
    randomSignal,
    settings.randomness,
  );

  const threshold = 1 - settings.dutyCycle;

  return timingSignal >= threshold
    ? 1
    : settings.offLevel;
}

function isEmissiveMaterial(
  material: unknown,
): material is EmissiveMaterial {
  return (
    material instanceof MeshStandardMaterial ||
    material instanceof MeshPhysicalMaterial
  );
}

function materialNamesInRoot(root: Object3D): string[] {
  const names = new Set<string>();

  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    for (const material of materials) {
      if (material?.name) {
        names.add(material.name);
      }
    }
  });

  return [...names].sort((a, b) =>
    a.localeCompare(b),
  );
}

function cloneAndRegisterMaterials(
  root: Object3D,
  runtimeIndex: number,
  diffuserBindings: EmissiveBinding[],
  indicatorBindings: IndicatorBinding[],
): {
  diffuserCount: number;
  indicatorCount: number;
} {
  let diffuserCount = 0;
  let indicatorCount = 0;

  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return;
    }

    const sourceMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    const nextMaterials = sourceMaterials.map((source) => {
      if (!isEmissiveMaterial(source)) {
        return source;
      }

      const isDiffuser = isNamedMaterial(
        source,
        DIFFUSER_MATERIAL_NAME,
      );

      const isIndicator = isNamedMaterial(
        source,
        INDICATOR_MATERIAL_NAME,
      );

      if (!isDiffuser && !isIndicator) {
        return source;
      }

      const material = source.clone();
      material.name =
        `${source.name}__YOKE_${runtimeIndex + 1}`;

      if (isDiffuser) {
        material.emissive.set(0xffffff);

        diffuserBindings.push({
          material,
          runtimeIndex,
        });

        diffuserCount += 1;

        console.info(
          `[PowerBox] Strobe material "${source.name}" ` +
          `→ Yoke ${runtimeIndex + 1}`,
        );
      }

      if (isIndicator) {
        indicatorBindings.push({
          material,
        });

        indicatorCount += 1;

        console.info(
          `[PowerBox] Constant indicator "${source.name}"`,
        );
      }

      return material;
    });

    object.material = Array.isArray(object.material)
      ? nextMaterials
      : nextMaterials[0];
  });

  return {
    diffuserCount,
    indicatorCount,
  };
}

function nearestRuntimeIndex(
  position: Vector3,
  runtimes: RuntimeYokeLight[],
  reserved: Set<number>,
): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  runtimes.forEach((runtime, index) => {
    if (reserved.has(index)) {
      return;
    }

    const distance = position.distanceToSquared(
      runtime.light.position,
    );

    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  if (bestIndex >= 0) {
    return bestIndex;
  }

  runtimes.forEach((runtime, index) => {
    const distance = position.distanceToSquared(
      runtime.light.position,
    );

    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });

  return Math.max(bestIndex, 0);
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

  const light = new SpotLight(
    color,
    config.energyWatts * settings.webCalibration,
    settings.distance,
    MathUtils.degToRad(settings.coneAngleDegrees),
    settings.penumbra,
    settings.decay,
  );

  light.name = `YOKE_BEAM__${config.name}`;
  light.position.set(
    config.position[0],
    config.position[1],
    config.position[2],
  );

  light.target.name = `YOKE_TARGET__${config.name}`;

  light.castShadow = settings.castShadows;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = settings.shadowBias;
  light.shadow.normalBias = settings.shadowNormalBias;

  light.userData.blenderObject = config.name;
  light.userData.blenderEnergyWatts = config.energyWatts;

  const helper = new SpotLightHelper(light);
  helper.name = `YOKE_SPOT_HELPER__${config.name}`;
  helper.visible = settings.showHelpers;

  return {
    config,
    light,
    helper,
    settings: {
      enabled: true,
      gain: 1,
      phase: index / YOKE_AREA_LIGHTS.length,

      positionX: 0,
      positionY: 0,
      positionZ: 0,

      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,

      angleOffset: 0,
      penumbraOffset: 0,
    },
    seed: 100 + index * 19,
  };
}

function updateBeamTransform(
  runtime: RuntimeYokeLight,
  settings: YokeLightSettings,
): void {
  runtime.light.position.set(
    runtime.config.position[0] +
      runtime.settings.positionX,
    runtime.config.position[1] +
      runtime.settings.positionY,
    runtime.config.position[2] +
      runtime.settings.positionZ,
  );

  const direction = settings.aimAtTarget
    ? new Vector3(
        settings.targetX,
        settings.targetY,
        settings.targetZ,
      ).sub(runtime.light.position)
    : new Vector3(
        runtime.config.directionMinusZ[0],
        runtime.config.directionMinusZ[1],
        runtime.config.directionMinusZ[2],
      ).multiplyScalar(-1);

  if (direction.lengthSq() < 0.000001) {
    direction.set(0, -1, 0);
  }

  direction.normalize();

  direction.applyEuler(
    new Euler(
      MathUtils.degToRad(settings.rotationX),
      MathUtils.degToRad(settings.rotationY),
      MathUtils.degToRad(settings.rotationZ),
      "XYZ",
    ),
  );

  direction.applyEuler(
    new Euler(
      MathUtils.degToRad(runtime.settings.rotationX),
      MathUtils.degToRad(runtime.settings.rotationY),
      MathUtils.degToRad(runtime.settings.rotationZ),
      "XYZ",
    ),
  );

  direction.normalize();

  runtime.light.target.position
    .copy(runtime.light.position)
    .addScaledVector(
      direction,
      settings.targetDistance,
    );

  runtime.light.angle = MathUtils.degToRad(
    MathUtils.clamp(
      settings.coneAngleDegrees +
        runtime.settings.angleOffset,
      1,
      89,
    ),
  );

  runtime.light.penumbra = MathUtils.clamp(
    settings.penumbra +
      runtime.settings.penumbraOffset,
    0,
    1,
  );

  runtime.light.distance = settings.distance;
  runtime.light.decay = settings.decay;
  runtime.light.castShadow = settings.castShadows;
  runtime.light.shadow.bias = settings.shadowBias;
  runtime.light.shadow.normalBias =
    settings.shadowNormalBias;

  runtime.light.target.updateMatrixWorld(true);
  runtime.light.updateMatrixWorld(true);
  runtime.helper.update();
}

export function createYokeLightRig(): YokeLightRig {
  const root = new Group();
  root.name = "YOKE_DIRECTIONAL_LIGHT_RIG";

  const lightGroup = new Group();
  lightGroup.name = "YOKE_SPOT_LIGHTS";

  const targetGroup = new Group();
  targetGroup.name = "YOKE_SPOT_TARGETS";

  const helperGroup = new Group();
  helperGroup.name = "YOKE_SPOT_HELPERS";

  root.add(lightGroup, targetGroup, helperGroup);

  const settings: YokeLightSettings = {
    enabled: true,

    energyWatts: 10,
    webCalibration: 3,
    brightness: 1,
    color: "#ffffff",

    aimAtTarget: true,
    targetX: 0,
    targetY: 0.3,
    targetZ: 0,
    targetDistance: 10,

    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,

    distance: 8,
    coneAngleDegrees: 30,
    penumbra: 0.12,
    decay: 2,

    castShadows: false,
    shadowBias: -0.0002,
    shadowNormalBias: 0.02,

    showHelpers: false,

    panelGlow: 3,
    indicatorGlow: 0.12,
    indicatorColor: "#ff5a14",

    switching: false,
    switchingSpeedHz: 2,
    dutyCycle: 0.5,
    randomness: 0,
    phaseSpread: 1,
    offLevel: 0,
  };

  const runtimeLights = YOKE_AREA_LIGHTS.map(
    (config, index) =>
      createRuntimeLight(config, index, settings),
  );

  const diffuserBindings: EmissiveBinding[] = [];
  const indicatorBindings: IndicatorBinding[] = [];
  const registeredRoots = new WeakSet<Object3D>();
  const reservedRuntimeIndexes = new Set<number>();

  for (const runtime of runtimeLights) {
    lightGroup.add(runtime.light);
    targetGroup.add(runtime.light.target);
    helperGroup.add(runtime.helper);
  }

  function syncStaticSettings(): void {
    const color = new Color(settings.color);
    const indicatorColor = new Color(
      settings.indicatorColor,
    );

    root.visible = settings.enabled;
    helperGroup.visible = settings.showHelpers;

    runtimeLights.forEach((runtime) => {
      runtime.light.color.copy(color);
      runtime.helper.visible = settings.showHelpers;

      updateBeamTransform(runtime, settings);
    });

    indicatorBindings.forEach((binding) => {
      binding.material.emissive.copy(indicatorColor);
      binding.material.emissiveIntensity =
        settings.indicatorGlow;
    });
  }

  function registerLedLightRoot(
    ledRoot: Object3D,
  ): void {
    if (registeredRoots.has(ledRoot)) {
      return;
    }

    registeredRoots.add(ledRoot);
    ledRoot.updateWorldMatrix(true, true);

    const worldPosition = ledRoot.getWorldPosition(
      new Vector3(),
    );

    const runtimeIndex = nearestRuntimeIndex(
      worldPosition,
      runtimeLights,
      reservedRuntimeIndexes,
    );

    reservedRuntimeIndexes.add(runtimeIndex);

    const result = cloneAndRegisterMaterials(
      ledRoot,
      runtimeIndex,
      diffuserBindings,
      indicatorBindings,
    );

    console.info(
      `[PowerBox] LED "${ledRoot.name}" → Yoke ${runtimeIndex + 1}; ` +
      `diffuser=${result.diffuserCount}, ` +
      `indicator=${result.indicatorCount}`,
    );

    if (
      result.diffuserCount === 0 ||
      result.indicatorCount === 0
    ) {
      console.info(
        `[PowerBox] Materials inside "${ledRoot.name}":`,
        materialNamesInRoot(ledRoot),
      );
    }

    syncStaticSettings();
  }

  function addGUI(gui: GUI): void {
    const folder = gui.addFolder("Yoke Beams + LED");

    folder
      .add(settings, "enabled")
      .name("Enabled")
      .onChange(syncStaticSettings);

    const lightFolder = folder.addFolder(
      "Light output",
    );

    lightFolder
      .add(settings, "energyWatts", 0, 100, 0.1)
      .name("Source energy W");

    lightFolder
      .add(
        settings,
        "webCalibration",
        0,
        20,
        0.01,
      )
      .name("Web calibration");

    lightFolder
      .add(settings, "brightness", 0, 20, 0.01)
      .name("Master brightness");

    lightFolder
      .addColor(settings, "color")
      .name("Light color")
      .onChange(syncStaticSettings);

    const aimingFolder = folder.addFolder(
      "Aim and rotation",
    );

    aimingFolder
      .add(settings, "aimAtTarget")
      .name("Aim at target")
      .onChange(syncStaticSettings);

    aimingFolder
      .add(settings, "targetX", -5, 5, 0.01)
      .name("Target X")
      .onChange(syncStaticSettings);

    aimingFolder
      .add(settings, "targetY", -2, 5, 0.01)
      .name("Target Y")
      .onChange(syncStaticSettings);

    aimingFolder
      .add(settings, "targetZ", -5, 5, 0.01)
      .name("Target Z")
      .onChange(syncStaticSettings);

    aimingFolder
      .add(settings, "rotationX", -180, 180, 0.1)
      .name("Global rotate X")
      .onChange(syncStaticSettings);

    aimingFolder
      .add(settings, "rotationY", -180, 180, 0.1)
      .name("Global rotate Y")
      .onChange(syncStaticSettings);

    aimingFolder
      .add(settings, "rotationZ", -180, 180, 0.1)
      .name("Global rotate Z")
      .onChange(syncStaticSettings);

    const beamFolder = folder.addFolder(
      "Beam shape",
    );

    beamFolder
      .add(settings, "coneAngleDegrees", 1, 89, 0.1)
      .name("Cone angle")
      .onChange(syncStaticSettings);

    beamFolder
      .add(settings, "penumbra", 0, 1, 0.01)
      .name("Edge softness")
      .onChange(syncStaticSettings);

    beamFolder
      .add(settings, "distance", 0.5, 30, 0.1)
      .name("Distance")
      .onChange(syncStaticSettings);

    beamFolder
      .add(settings, "decay", 0, 2, 0.01)
      .name("Decay")
      .onChange(syncStaticSettings);

    beamFolder
      .add(settings, "showHelpers")
      .name("Show cones")
      .onChange(syncStaticSettings);

    const shadowFolder = folder.addFolder("Shadows");

    shadowFolder
      .add(settings, "castShadows")
      .name("Cast shadows")
      .onChange(syncStaticSettings);

    shadowFolder
      .add(
        settings,
        "shadowBias",
        -0.01,
        0.01,
        0.0001,
      )
      .name("Shadow bias")
      .onChange(syncStaticSettings);

    shadowFolder
      .add(
        settings,
        "shadowNormalBias",
        0,
        0.2,
        0.001,
      )
      .name("Normal bias")
      .onChange(syncStaticSettings);

    const materialFolder = folder.addFolder(
      "Lamp materials",
    );

    materialFolder
      .add(settings, "panelGlow", 0, 20, 0.01)
      .name("Diffuser strobe");

    materialFolder
      .add(
        settings,
        "indicatorGlow",
        0,
        2,
        0.01,
      )
      .name("Orange indicator");

    materialFolder
      .addColor(settings, "indicatorColor")
      .name("Indicator color")
      .onChange(syncStaticSettings);

    const switchingFolder = folder.addFolder(
      "Hard switching",
    );

    switchingFolder
      .add(settings, "switching")
      .name("Enabled");

    switchingFolder
      .add(
        settings,
        "switchingSpeedHz",
        0.05,
        20,
        0.01,
      )
      .name("Speed Hz");

    switchingFolder
      .add(settings, "dutyCycle", 0.05, 0.95, 0.01)
      .name("On duration");

    switchingFolder
      .add(settings, "randomness", 0, 1, 0.01)
      .name("Random timing");

    switchingFolder
      .add(settings, "phaseSpread", 0, 1, 0.01)
      .name("Phase spread");

    switchingFolder
      .add(settings, "offLevel", 0, 1, 0.01)
      .name("Off level");

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
        .name("Intensity");

      const positionFolder = itemFolder.addFolder(
        "Position offset",
      );

      positionFolder
        .add(runtime.settings, "positionX", -3, 3, 0.01)
        .name("X")
        .onChange(syncStaticSettings);

      positionFolder
        .add(runtime.settings, "positionY", -3, 3, 0.01)
        .name("Y")
        .onChange(syncStaticSettings);

      positionFolder
        .add(runtime.settings, "positionZ", -3, 3, 0.01)
        .name("Z")
        .onChange(syncStaticSettings);

      const rotationFolder = itemFolder.addFolder(
        "Rotation offset",
      );

      rotationFolder
        .add(
          runtime.settings,
          "rotationX",
          -180,
          180,
          0.1,
        )
        .name("Rotate X")
        .onChange(syncStaticSettings);

      rotationFolder
        .add(
          runtime.settings,
          "rotationY",
          -180,
          180,
          0.1,
        )
        .name("Rotate Y")
        .onChange(syncStaticSettings);

      rotationFolder
        .add(
          runtime.settings,
          "rotationZ",
          -180,
          180,
          0.1,
        )
        .name("Rotate Z")
        .onChange(syncStaticSettings);

      itemFolder
        .add(
          runtime.settings,
          "angleOffset",
          -40,
          40,
          0.1,
        )
        .name("Cone offset")
        .onChange(syncStaticSettings);

      itemFolder
        .add(
          runtime.settings,
          "penumbraOffset",
          -1,
          1,
          0.01,
        )
        .name("Softness offset")
        .onChange(syncStaticSettings);

      itemFolder
        .add(runtime.settings, "phase", 0, 1, 0.01)
        .name("Strobe phase");
    });

    syncStaticSettings();
  }

  function update(timeSeconds: number): void {
    if (!settings.enabled) {
      return;
    }

    const lightColor = new Color(settings.color);
    const indicatorColor = new Color(
      settings.indicatorColor,
    );

    const modulationByIndex: number[] = [];

    runtimeLights.forEach((runtime, index) => {
      const enabled = runtime.settings.enabled;

      const modulation = enabled
        ? hardSwitchSignal(
            timeSeconds,
            index,
            runtime,
            settings,
          )
        : 0;

      modulationByIndex[index] = modulation;

      runtime.light.visible = enabled;
      runtime.light.color.copy(lightColor);

      runtime.light.intensity =
        settings.energyWatts *
        settings.webCalibration *
        settings.brightness *
        runtime.settings.gain *
        modulation;
    });

    diffuserBindings.forEach((binding) => {
      const runtime =
        runtimeLights[binding.runtimeIndex];

      const modulation =
        modulationByIndex[binding.runtimeIndex] ?? 0;

      binding.material.emissive.copy(lightColor);
      binding.material.emissiveIntensity =
        settings.panelGlow *
        runtime.settings.gain *
        modulation;
    });

    indicatorBindings.forEach((binding) => {
      binding.material.emissive.copy(indicatorColor);
      binding.material.emissiveIntensity =
        settings.indicatorGlow;
    });

    if (settings.showHelpers) {
      runtimeLights.forEach((runtime) => {
        runtime.helper.update();
      });
    }
  }

  syncStaticSettings();

  return {
    root,
    addGUI,
    update,
    registerLedLightRoot,
  };
}
