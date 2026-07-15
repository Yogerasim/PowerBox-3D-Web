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
  domElement: HTMLElement;
  setValue: (value: unknown) => unknown;
}

interface GuiLike {
  domElement: HTMLElement;
  controllers: ControllerLike[];
  folders: GuiLike[];
}

function directText(
  element: HTMLElement,
  selector: string,
): string {
  return (
    element
      .querySelector<HTMLElement>(selector)
      ?.textContent
      ?.trim() ?? ""
  );
}

function folderTitle(folder: GuiLike): string {
  return directText(
    folder.domElement,
    ":scope > .title",
  );
}

function controllerTitle(
  controller: ControllerLike,
): string {
  return directText(
    controller.domElement,
    ":scope > .name",
  );
}

function presetKey(
  path: readonly string[],
  name: string,
): string {
  return JSON.stringify([...path, name]);
}

function collectControllers(
  gui: GuiLike,
  path: string[],
  result: Map<string, ControllerLike>,
): void {
  for (const controller of gui.controllers) {
    const name = controllerTitle(controller);

    if (!name) {
      continue;
    }

    result.set(
      presetKey(path, name),
      controller,
    );
  }

  for (const folder of gui.folders) {
    const title = folderTitle(folder);

    collectControllers(
      folder,
      title ? [...path, title] : path,
      result,
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
      `[PowerBox] Scene Lab preset HTTP ${response.status}.`,
    );
    return;
  }

  const preset =
    await response.json() as SceneLabPreset;

  const controllers =
    new Map<string, ControllerLike>();

  collectControllers(
    gui as unknown as GuiLike,
    [],
    controllers,
  );

  let applied = 0;
  const missing: string[] = [];

  for (const item of preset.controllers) {
    const key = presetKey(
      item.path,
      item.name,
    );

    const controller = controllers.get(key);

    if (!controller) {
      missing.push(
        [...item.path, item.name].join(" → "),
      );
      continue;
    }

    controller.setValue(item.value);
    applied += 1;
  }

  console.info(
    `[PowerBox] Scene Lab preset applied: ${applied}/` +
    `${preset.controllers.length}`,
  );

  if (missing.length > 0) {
    console.info(
      "[PowerBox] Preset controllers not found:",
      missing,
    );
  }
}
