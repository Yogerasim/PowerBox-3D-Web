import type GUI from "lil-gui";

export interface RelayClickAudio {
  addGUI: (gui: GUI) => void;
  play: (channel: number, enabled: boolean) => void;
}

const STORAGE_KEY = "powerbox.relay-click-audio.v2";

interface RelayClickSettings {
  enabled: boolean;
  volume: number;
  onPitch: number;
  offPitch: number;
  pitchDrop: number;
  durationMs: number;
  toneMix: number;
  noiseMix: number;
  noiseFrequency: number;
  noiseQ: number;
  stereoWidth: number;
  pitchVariation: number;
}

const PROJECT_DEFAULTS: RelayClickSettings = {
  enabled: true,
  volume: 0.64,
  onPitch: 700,
  offPitch: 124,
  pitchDrop: 1,
  durationMs: 60,
  toneMix: 0.91,
  noiseMix: 0,
  noiseFrequency: 6000,
  noiseQ: 0.2,
  stereoWidth: 1,
  pitchVariation: 0.2,
};

export function createRelayClickAudio(): RelayClickAudio {
  let context: AudioContext | null = null;
  let noiseBuffer: AudioBuffer | null = null;
  let confirmationPlayed = false;

  const state: RelayClickSettings & {
    status: string;
    presetStatus: string;
  } = {
    ...PROJECT_DEFAULTS,
    status: "Tap or click once to enable relay sound",
    presetStatus: "Using project defaults",
  };

  const startOverlay = document.createElement("button");
  const locale = new URLSearchParams(location.search).get("lang") === "ru"
    ? "ru"
    : "en";
  const startLabel = locale === "ru"
    ? "Запустить со звуком"
    : "Start with sound";
  startOverlay.type = "button";
  startOverlay.className = "relay-audio-start";
  startOverlay.innerHTML = `<span>${startLabel}</span>`;
  startOverlay.setAttribute("aria-label", startLabel);
  document.body.appendChild(startOverlay);

  function settingsSnapshot(): RelayClickSettings {
    const {
      status: _status,
      presetStatus: _presetStatus,
      ...settings
    } = state;
    return structuredClone(settings);
  }

  function restoreSavedSettings(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      Object.assign(state, JSON.parse(saved) as Partial<RelayClickSettings>);
      state.presetStatus = "Saved audio settings restored";
    } catch (error) {
      console.warn("[PowerBox] Relay audio settings could not be restored", error);
      state.presetStatus = "Could not restore saved settings";
    }
  }

  function saveSettings(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsSnapshot()));
    state.presetStatus = "Audio settings saved in this browser";
    console.info("[PowerBox] Relay audio settings saved", settingsSnapshot());
  }

  function downloadSettings(): void {
    const blob = new Blob([JSON.stringify(settingsSnapshot(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "powerbox-relay-click-audio.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  restoreSavedSettings();

  async function unlock(): Promise<void> {
    if (!context) {
      context = new AudioContext({ latencyHint: "interactive" });
      noiseBuffer = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * 0.04),
        context.sampleRate,
      );

      const data = noiseBuffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        data[index] = Math.random() * 2 - 1;
      }
    }

    if (context.state !== "running") {
      await context.resume();
    }

    state.status = context.state === "running"
      ? "Relay clicks ready"
      : "Scroll, tap or press a key to enable relay sound";
  }

  const removeUnlockListeners = (): void => {
    document.removeEventListener("pointerdown", unlockFromGesture, true);
    document.removeEventListener("touchstart", unlockFromGesture, true);
    window.removeEventListener("wheel", unlockFromGesture, true);
    window.removeEventListener("keydown", unlockFromGesture, true);
  };

  const unlockFromGesture = (): void => {
    void unlock().then(() => {
      if (context?.state === "running") {
        removeUnlockListeners();
        startOverlay.remove();
        if (!confirmationPlayed) {
          confirmationPlayed = true;
          play(0, true);
        }
      }
    });
  };

  // Capture the very first gesture before OrbitControls or GUI widgets can
  // stop propagation. Keep the listeners until resume() really succeeds.
  document.addEventListener("pointerdown", unlockFromGesture, {
    capture: true,
    passive: true,
  });
  document.addEventListener("touchstart", unlockFromGesture, {
    capture: true,
    passive: true,
  });
  window.addEventListener("wheel", unlockFromGesture, {
    capture: true,
    passive: true,
  });
  window.addEventListener("keydown", unlockFromGesture, { capture: true });

  function play(channel: number, enabled: boolean): void {
    if (!state.enabled || !context || context.state !== "running") return;

    const now = context.currentTime;
    const output = context.createGain();
    const pan = context.createStereoPanner();
    const oscillator = context.createOscillator();
    const oscillatorGain = context.createGain();
    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();

    output.gain.value = state.volume;
    const duration = Math.max(0.012, state.durationMs / 1000);
    const variation = 1 + (Math.random() * 2 - 1) * state.pitchVariation;
    const startPitch = (enabled ? state.onPitch : state.offPitch) * variation;
    const endPitch = Math.max(30, startPitch * state.pitchDrop);

    pan.pan.value = ((channel / 7) * 2 - 1) * state.stereoWidth;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(startPitch, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      endPitch,
      now + duration * 0.78,
    );
    oscillatorGain.gain.setValueAtTime(Math.max(0.001, state.toneMix), now);
    oscillatorGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.buffer = noiseBuffer;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = state.noiseFrequency * (enabled ? 1.12 : 0.88);
    noiseFilter.Q.value = state.noiseQ;
    noiseGain.gain.setValueAtTime(Math.max(0.001, state.noiseMix), now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.72);

    oscillator.connect(oscillatorGain).connect(output);
    noise.connect(noiseFilter).connect(noiseGain).connect(output);
    output.connect(pan).connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + duration + 0.005);
    noise.start(now);
    noise.stop(now + duration);
  }

  function addGUI(gui: GUI): void {
    const folder = gui.addFolder("Relay click audio");
    folder.add(state, "enabled").name("Clicks enabled").onChange(saveSettings);
    folder.add(state, "volume", 0, 1, 0.01).name("Click volume").onChange(saveSettings);
    folder.add(state, "onPitch", 50, 700, 1).name("ON pitch Hz").onChange(saveSettings);
    folder.add(state, "offPitch", 50, 700, 1).name("OFF pitch Hz").onChange(saveSettings);
    folder.add(state, "pitchDrop", 0.15, 1, 0.01).name("Pitch drop").onChange(saveSettings);
    folder.add(state, "durationMs", 12, 120, 1).name("Duration ms").onChange(saveSettings);
    folder.add(state, "toneMix", 0, 1.5, 0.01).name("Mechanical tone").onChange(saveSettings);
    folder.add(state, "noiseMix", 0, 1.5, 0.01).name("Contact noise").onChange(saveSettings);
    folder
      .add(state, "noiseFrequency", 300, 6000, 10)
      .name("Noise frequency")
      .onChange(saveSettings);
    folder.add(state, "noiseQ", 0.2, 8, 0.1).name("Noise sharpness").onChange(saveSettings);
    folder.add(state, "stereoWidth", 0, 1, 0.01).name("Stereo spread").onChange(saveSettings);
    folder
      .add(state, "pitchVariation", 0, 0.2, 0.005)
      .name("Pitch variation")
      .onChange(saveSettings);
    folder.add({ testOn: () => {
      void unlock().then(() => play(3, true));
    } }, "testOn").name("Test ON click");
    folder.add({ testOff: () => {
      void unlock().then(() => play(4, false));
    } }, "testOff").name("Test OFF click");
    folder.add({ save: saveSettings }, "save").name("Save audio settings");
    folder.add({ download: downloadSettings }, "download").name("Download audio JSON");
    folder.add(state, "presetStatus").name("Settings").listen().disable();
    folder.add(state, "status").name("Status").listen().disable();
    folder.close();
  }

  return { addGUI, play };
}
