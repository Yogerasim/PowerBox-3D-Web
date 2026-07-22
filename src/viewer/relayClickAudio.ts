import type GUI from "lil-gui";

export interface RelayClickAudio {
  addGUI: (gui: GUI) => void;
  play: (channel: number, enabled: boolean) => void;
}

export function createRelayClickAudio(): RelayClickAudio {
  let context: AudioContext | null = null;
  let noiseBuffer: AudioBuffer | null = null;

  const state = {
    enabled: true,
    volume: 0.24,
    onPitch: 185,
    offPitch: 125,
    pitchDrop: 0.5,
    durationMs: 34,
    toneMix: 0.7,
    noiseMix: 0.34,
    noiseFrequency: 1900,
    noiseQ: 1.4,
    stereoWidth: 0.55,
    pitchVariation: 0.035,
    status: "Tap or click once to enable relay sound",
  };

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

    state.status = "Relay clicks ready";
  }

  const removeUnlockListeners = (): void => {
    document.removeEventListener("pointerdown", unlockFromGesture, true);
    document.removeEventListener("touchstart", unlockFromGesture, true);
    window.removeEventListener("keydown", unlockFromGesture, true);
  };

  const unlockFromGesture = (): void => {
    void unlock().then(() => {
      if (context?.state === "running") removeUnlockListeners();
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
    folder.add(state, "enabled").name("Clicks enabled");
    folder.add(state, "volume", 0, 1, 0.01).name("Click volume");
    folder.add(state, "onPitch", 50, 700, 1).name("ON pitch Hz");
    folder.add(state, "offPitch", 50, 700, 1).name("OFF pitch Hz");
    folder.add(state, "pitchDrop", 0.15, 1, 0.01).name("Pitch drop");
    folder.add(state, "durationMs", 12, 120, 1).name("Duration ms");
    folder.add(state, "toneMix", 0, 1.5, 0.01).name("Mechanical tone");
    folder.add(state, "noiseMix", 0, 1.5, 0.01).name("Contact noise");
    folder
      .add(state, "noiseFrequency", 300, 6000, 10)
      .name("Noise frequency");
    folder.add(state, "noiseQ", 0.2, 8, 0.1).name("Noise sharpness");
    folder.add(state, "stereoWidth", 0, 1, 0.01).name("Stereo spread");
    folder
      .add(state, "pitchVariation", 0, 0.2, 0.005)
      .name("Pitch variation");
    folder.add({ testOn: () => {
      void unlock().then(() => play(3, true));
    } }, "testOn").name("Test ON click");
    folder.add({ testOff: () => {
      void unlock().then(() => play(4, false));
    } }, "testOff").name("Test OFF click");
    folder.add(state, "status").name("Status").listen().disable();
    folder.close();
  }

  return { addGUI, play };
}
