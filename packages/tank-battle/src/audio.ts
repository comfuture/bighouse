type AudioContextConstructor = new () => AudioContext;

const SILENCE = 0.0001;
const MASTER_VOLUME = 0.16;

type FlightSound = {
  source: AudioBufferSourceNode;
  oscillator: OscillatorNode;
  gain: GainNode;
};

export type TankBattleAudioController = {
  /** Call from a pointer or keyboard event to create and unlock Web Audio. */
  unlock(): Promise<boolean>;
  /** Resume an existing context without creating one. */
  resume(): Promise<boolean>;
  playGearCreak(intensity?: number): void;
  playLaunch(): void;
  playFlight(): void;
  stopFlight(): void;
  playTerrainExplosion(): void;
  playTankExplosion(): void;
  destroy(): void;
};

/**
 * Creates a best-effort synthesized sound controller for Tank Battle.
 * Playback methods are silent until unlock() succeeds from a user gesture.
 */
export function createTankBattleAudio(): TankBattleAudioController {
  let context: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let flight: FlightSound | null = null;
  let destroyed = false;
  const activeSources = new Set<AudioScheduledSourceNode>();

  function createContext(): AudioContext | null {
    if (destroyed || context || typeof window === "undefined") return context;
    const audioWindow = window as typeof window & {
      webkitAudioContext?: AudioContextConstructor;
    };
    const AudioContextClass = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioContextClass) return null;

    try {
      context = new AudioContextClass();
      masterGain = context.createGain();
      masterGain.gain.setValueAtTime(MASTER_VOLUME, context.currentTime);
      masterGain.connect(context.destination);
      return context;
    } catch {
      context = null;
      masterGain = null;
      return null;
    }
  }

  async function resumeContext(audioContext: AudioContext | null): Promise<boolean> {
    if (!audioContext || destroyed || audioContext.state === "closed") return false;
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      return audioContext.state === "running";
    } catch {
      return false;
    }
  }

  function runningContext(): AudioContext | null {
    if (destroyed || !context || context.state !== "running" || !masterGain) return null;
    return context;
  }

  function output(): GainNode | null {
    return masterGain;
  }

  function trackSource<T extends AudioScheduledSourceNode>(source: T, ...nodes: AudioNode[]): T {
    activeSources.add(source);
    source.addEventListener("ended", () => {
      activeSources.delete(source);
      safelyDisconnect(source, ...nodes);
    }, { once: true });
    return source;
  }

  function playGearCreak(intensity = 0.5): void {
    const audioContext = runningContext();
    const destination = output();
    if (!audioContext || !destination) return;

    safely(() => {
      const amount = clamp(intensity, 0, 1);
      const now = audioContext.currentTime;
      const duration = 0.1 + amount * 0.18;
      const oscillator = audioContext.createOscillator();
      const filter = audioContext.createBiquadFilter();
      const gain = audioContext.createGain();

      oscillator.type = "sawtooth";
      oscillator.frequency.setValueAtTime(115 + amount * 55, now);
      oscillator.frequency.exponentialRampToValueAtTime(48 + amount * 20, now + duration);
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(520 + amount * 420, now);
      filter.frequency.exponentialRampToValueAtTime(170, now + duration);
      filter.Q.setValueAtTime(3.2, now);
      gain.gain.setValueAtTime(SILENCE, now);
      gain.gain.exponentialRampToValueAtTime(0.035 + amount * 0.035, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(SILENCE, now + duration);

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      trackSource(oscillator, filter, gain);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    });
  }

  function playLaunch(): void {
    const audioContext = runningContext();
    const destination = output();
    if (!audioContext || !destination) return;

    stopFlight();
    safely(() => {
      const now = audioContext.currentTime;
      const duration = 0.24;
      playNoiseBurst(audioContext, destination, {
        start: now,
        duration,
        filterType: "lowpass",
        startFrequency: 1_700,
        endFrequency: 240,
        peakGain: 0.13
      });
      playOscillatorSweep(audioContext, destination, {
        start: now,
        duration: 0.2,
        type: "triangle",
        startFrequency: 125,
        endFrequency: 42,
        peakGain: 0.12
      });
    });
  }

  function playFlight(): void {
    const audioContext = runningContext();
    const destination = output();
    if (!audioContext || !destination || flight) return;

    safely(() => {
      const now = audioContext.currentTime;
      const source = audioContext.createBufferSource();
      const oscillator = audioContext.createOscillator();
      const noiseFilter = audioContext.createBiquadFilter();
      const toneFilter = audioContext.createBiquadFilter();
      const noiseGain = audioContext.createGain();
      const toneGain = audioContext.createGain();
      const flightGain = audioContext.createGain();

      source.buffer = createNoiseBuffer(audioContext, 0.5);
      source.loop = true;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(205, now);
      oscillator.frequency.linearRampToValueAtTime(310, now + 1.2);
      noiseFilter.type = "bandpass";
      noiseFilter.frequency.setValueAtTime(1_150, now);
      noiseFilter.frequency.linearRampToValueAtTime(1_950, now + 1.2);
      noiseFilter.Q.setValueAtTime(2.1, now);
      toneFilter.type = "lowpass";
      toneFilter.frequency.setValueAtTime(900, now);
      noiseGain.gain.setValueAtTime(0.13, now);
      toneGain.gain.setValueAtTime(0.028, now);
      flightGain.gain.setValueAtTime(SILENCE, now);
      flightGain.gain.exponentialRampToValueAtTime(0.22, now + 0.08);

      source.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(flightGain);
      oscillator.connect(toneFilter);
      toneFilter.connect(toneGain);
      toneGain.connect(flightGain);
      flightGain.connect(destination);

      const connectedNodes = [noiseFilter, noiseGain, toneFilter, toneGain, flightGain];
      trackSource(source, ...connectedNodes);
      trackSource(oscillator, ...connectedNodes);
      flight = { source, oscillator, gain: flightGain };
      source.start(now);
      oscillator.start(now);
    });
  }

  function stopFlight(): void {
    const currentFlight = flight;
    flight = null;
    if (!currentFlight || !context || context.state === "closed") return;

    safely(() => {
      const now = context!.currentTime;
      const end = now + 0.12;
      currentFlight.gain.gain.cancelScheduledValues(now);
      currentFlight.gain.gain.setValueAtTime(Math.max(SILENCE, currentFlight.gain.gain.value), now);
      currentFlight.gain.gain.exponentialRampToValueAtTime(SILENCE, end);
      currentFlight.source.stop(end + 0.02);
      currentFlight.oscillator.stop(end + 0.02);
    });
  }

  function playTerrainExplosion(): void {
    playExplosion({ noiseGain: 0.2, toneGain: 0.1, startFrequency: 105, duration: 0.48 });
  }

  function playTankExplosion(): void {
    const audioContext = runningContext();
    const destination = output();
    if (!audioContext || !destination) return;

    stopFlight();
    playExplosion({ noiseGain: 0.26, toneGain: 0.16, startFrequency: 82, duration: 0.72 });
    safely(() => {
      const now = audioContext.currentTime + 0.055;
      playNoiseBurst(audioContext, destination, {
        start: now,
        duration: 0.38,
        filterType: "bandpass",
        startFrequency: 2_800,
        endFrequency: 620,
        peakGain: 0.075
      });
    });
  }

  function playExplosion(options: {
    noiseGain: number;
    toneGain: number;
    startFrequency: number;
    duration: number;
  }): void {
    const audioContext = runningContext();
    const destination = output();
    if (!audioContext || !destination) return;

    stopFlight();
    safely(() => {
      const now = audioContext.currentTime;
      playNoiseBurst(audioContext, destination, {
        start: now,
        duration: options.duration,
        filterType: "lowpass",
        startFrequency: 1_350,
        endFrequency: 110,
        peakGain: options.noiseGain
      });
      playOscillatorSweep(audioContext, destination, {
        start: now,
        duration: options.duration * 0.7,
        type: "sine",
        startFrequency: options.startFrequency,
        endFrequency: 28,
        peakGain: options.toneGain
      });
    });
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    stopFlight();

    for (const source of activeSources) {
      safely(() => source.stop());
      safelyDisconnect(source);
    }
    activeSources.clear();
    safelyDisconnect(masterGain);
    const audioContext = context;
    context = null;
    masterGain = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => {});
    }
  }

  return {
    unlock: async () => resumeContext(createContext()),
    resume: async () => resumeContext(context),
    playGearCreak,
    playLaunch,
    playFlight,
    stopFlight,
    playTerrainExplosion,
    playTankExplosion,
    destroy
  };
}

function playNoiseBurst(
  context: AudioContext,
  destination: AudioNode,
  options: {
    start: number;
    duration: number;
    filterType: BiquadFilterType;
    startFrequency: number;
    endFrequency: number;
    peakGain: number;
  }
): void {
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const end = options.start + options.duration;

  source.buffer = createNoiseBuffer(context, options.duration);
  filter.type = options.filterType;
  filter.frequency.setValueAtTime(options.startFrequency, options.start);
  filter.frequency.exponentialRampToValueAtTime(options.endFrequency, end);
  filter.Q.setValueAtTime(options.filterType === "bandpass" ? 1.7 : 0.8, options.start);
  gain.gain.setValueAtTime(SILENCE, options.start);
  gain.gain.exponentialRampToValueAtTime(options.peakGain, options.start + 0.012);
  gain.gain.exponentialRampToValueAtTime(SILENCE, end);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.addEventListener("ended", () => safelyDisconnect(source, filter, gain), { once: true });
  source.start(options.start);
  source.stop(end + 0.02);
}

function playOscillatorSweep(
  context: AudioContext,
  destination: AudioNode,
  options: {
    start: number;
    duration: number;
    type: OscillatorType;
    startFrequency: number;
    endFrequency: number;
    peakGain: number;
  }
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const end = options.start + options.duration;

  oscillator.type = options.type;
  oscillator.frequency.setValueAtTime(options.startFrequency, options.start);
  oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, end);
  gain.gain.setValueAtTime(SILENCE, options.start);
  gain.gain.exponentialRampToValueAtTime(options.peakGain, options.start + 0.01);
  gain.gain.exponentialRampToValueAtTime(SILENCE, end);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.addEventListener("ended", () => safelyDisconnect(oscillator, gain), { once: true });
  oscillator.start(options.start);
  oscillator.stop(end + 0.02);
}

function createNoiseBuffer(context: AudioContext, duration: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = Math.random() * 2 - 1;
  }
  return buffer;
}

function safelyDisconnect(...nodes: Array<AudioNode | null>): void {
  for (const node of nodes) {
    if (!node) continue;
    try {
      node.disconnect();
    } catch {
      // Web Audio feedback is best-effort and must never affect gameplay.
    }
  }
}

function safely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Web Audio can be unavailable or interrupted; gameplay continues silently.
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
