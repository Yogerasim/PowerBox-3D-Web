import type GUI from "lil-gui";

export interface SceneLabPreset {
  controllers: Record<string, unknown>;
  folders: Record<string, SceneLabPreset>;
}

function countControllers(
  preset: SceneLabPreset,
): number {
  let count = Object.keys(
    preset.controllers ?? {},
  ).length;

  for (
    const folder of Object.values(
      preset.folders ?? {},
    )
  ) {
    count += countControllers(folder);
  }

  return count;
}

function isSceneLabPreset(
  value: unknown,
): value is SceneLabPreset {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const candidate =
    value as Partial<SceneLabPreset>;

  return (
    typeof candidate.controllers === "object" &&
    candidate.controllers !== null &&
    typeof candidate.folders === "object" &&
    candidate.folders !== null
  );
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

  const preset = await response.json() as unknown;

  if (!isSceneLabPreset(preset)) {
    console.warn(
      "[PowerBox] Scene Lab preset has an invalid format.",
    );
    return;
  }

  const typedPreset = preset as SceneLabPreset;

  gui.load(typedPreset);

  console.info(
    `[PowerBox] Complete Scene Lab preset loaded: ` +
    `${countControllers(typedPreset)} settings.`,
  );
}

export function downloadSceneLabPreset(
  gui: GUI,
  filename =
    "powerbox-scene-lab-preset.json",
): void {
  const preset = gui.save() as SceneLabPreset;
  const text = JSON.stringify(
    preset,
    null,
    2,
  );

  const blob = new Blob([text], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  console.info(
    `[PowerBox] Complete Scene Lab preset downloaded: ` +
    `${countControllers(preset)} settings.`,
  );
}
