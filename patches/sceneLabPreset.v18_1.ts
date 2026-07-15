import type GUI from "lil-gui";

interface SavedController {
  path: string[];
  name: string;
  value: string | number | boolean;
}

interface SceneLabPreset {
  version: number;
  createdAt?: string;
  controllers: SavedController[];
}

interface ControllerLike {
  getValue: () => unknown;
  setValue: (value: unknown) => unknown;
  property?: string;
  _name?: string;
}

interface GuiLike {
  controllersRecursive: () => ControllerLike[];
}

function isNumericString(value: string): boolean {
  return (
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  );
}

function isHexColor(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.trim())
  );
}

function isCompatibleValue(
  savedValue: unknown,
  currentValue: unknown,
): boolean {
  if (typeof currentValue === "boolean") {
    return typeof savedValue === "boolean";
  }

  if (typeof currentValue === "number") {
    return (
      typeof savedValue === "number" ||
      (
        typeof savedValue === "string" &&
        isNumericString(savedValue)
      )
    );
  }

  if (typeof currentValue === "string") {
    if (isHexColor(currentValue)) {
      return isHexColor(savedValue);
    }

    return (
      typeof savedValue === "string" &&
      !isHexColor(savedValue)
    );
  }

  return false;
}

function coerceValue(
  savedValue: string | number | boolean,
  currentValue: unknown,
): string | number | boolean {
  if (typeof currentValue === "number") {
    return Number(savedValue);
  }

  if (typeof currentValue === "boolean") {
    return Boolean(savedValue);
  }

  return String(savedValue);
}

function isLegacyUnnamedPreset(
  preset: SceneLabPreset,
): boolean {
  return (
    preset.controllers.length > 0 &&
    preset.controllers.every(
      (item) =>
        item.name === "unnamed" &&
        item.path.length === 0,
    )
  );
}

function applyLegacySequentialPreset(
  gui: GUI,
  preset: SceneLabPreset,
): void {
  const controllers = (
    gui as unknown as GuiLike
  )
    .controllersRecursive()
    .filter((controller) => {
      const value = controller.getValue();

      return (
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string"
      );
    });

  let savedIndex = 0;
  let applied = 0;
  let skippedSaved = 0;

  for (const controller of controllers) {
    const currentValue = controller.getValue();
    let matchingItem: SavedController | undefined;

    while (savedIndex < preset.controllers.length) {
      const candidate =
        preset.controllers[savedIndex];

      savedIndex += 1;

      if (
        isCompatibleValue(
          candidate.value,
          currentValue,
        )
      ) {
        matchingItem = candidate;
        break;
      }

      skippedSaved += 1;
    }

    if (!matchingItem) {
      break;
    }

    controller.setValue(
      coerceValue(
        matchingItem.value,
        currentValue,
      ),
    );

    applied += 1;
  }

  console.info(
    `[PowerBox] Legacy Scene Lab preset applied: ` +
    `${applied}/${controllers.length}; ` +
    `saved values=${preset.controllers.length}; ` +
    `duplicates skipped=${skippedSaved}`,
  );

  if (applied !== controllers.length) {
    console.warn(
      "[PowerBox] Scene Lab preset was only partially applied.",
      {
        applied,
        controllerCount: controllers.length,
        savedValueCount: preset.controllers.length,
      },
    );
  }
}

export async function loadSceneLabPreset(
  gui: GUI,
): Promise<void> {
  const url =
    `${import.meta.env.BASE_URL}` +
    "config/scene-lab-preset.json";

  let response: Response;

  try {
    response = await fetch(url, {
      cache: "no-store",
    });
  } catch (error) {
    console.warn(
      "[PowerBox] Scene Lab preset request failed.",
      error,
    );
    return;
  }

  if (response.status === 404) {
    console.info(
      "[PowerBox] Scene Lab preset is not configured.",
    );
    return;
  }

  if (!response.ok) {
    console.warn(
      `[PowerBox] Scene Lab preset HTTP ` +
      `${response.status}.`,
    );
    return;
  }

  const preset =
    await response.json() as SceneLabPreset;

  if (
    !Array.isArray(preset.controllers) ||
    preset.controllers.length === 0
  ) {
    console.warn(
      "[PowerBox] Scene Lab preset is empty.",
    );
    return;
  }

  if (isLegacyUnnamedPreset(preset)) {
    applyLegacySequentialPreset(gui, preset);
    return;
  }

  console.warn(
    "[PowerBox] Unsupported Scene Lab preset format.",
  );
}
