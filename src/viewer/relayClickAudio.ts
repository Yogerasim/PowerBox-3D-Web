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

  const unlockOnce = (): void => {
    void unlock();
  };

  window.addEventListener("pointerdown", unlockOnce, { once: true });
  window.addEventListener("touchend", unlockOnce, { once: true });
  window.addEventListener("keydown", unlockOnce, { once: true });

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
    pan.pan.value = ((channel / 7) * 2 - 1) * 0.55;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(enabled ? 185 : 125, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      enabled ? 92 : 72,
      now + 0.025,
    );
    oscillatorGain.gain.setValueAtTime(0.7, now);
    oscillatorGain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);

    noise.buffer = noiseBuffer;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = enabled ? 2200 : 1500;
    noiseFilter.Q.value = 1.4;
    noiseGain.gain.setValueAtTime(0.34, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

    oscillator.connect(oscillatorGain).connect(output);
    noise.connect(noiseFilter).connect(noiseGain).connect(output);
    output.connect(pan).connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.04);
    noise.start(now);
    noise.stop(now + 0.025);
  }

  function addGUI(gui: GUI): void {
    const folder = gui.addFolder("Relay click audio");
    folder.add(state, "enabled").name("Clicks enabled");
    folder.add(state, "volume", 0, 1, 0.01).name("Click volume");
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
