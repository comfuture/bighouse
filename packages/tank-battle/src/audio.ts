import bgmTankBattleUrl from "./assets/audio/bgm_tank_battle.mp3?url";
import sfxTurretGearUrl from "./assets/audio/sfx_turret_gear.wav?url";
import sfxCannonFireUrl from "./assets/audio/sfx_cannon_fire.wav?url";
import sfxShellWhistleUrl from "./assets/audio/sfx_shell_whistle.wav?url";
import sfxExplosionTerrainUrl from "./assets/audio/sfx_explosion_terrain.wav?url";
import sfxExplosionTankUrl from "./assets/audio/sfx_explosion_tank.wav?url";
import sfxItemSelectUrl from "./assets/audio/sfx_item_select.wav?url";
import sfxVictoryUrl from "./assets/audio/sfx_victory.wav?url";
import sfxDefeatUrl from "./assets/audio/sfx_defeat.wav?url";

type AudioContextConstructor = new () => AudioContext;

export const TANK_BATTLE_MUTE_STORAGE_KEY = "bighouse:tank-battle:muted";

const SILENCE = 0.0001;
const BGM_VOLUME = 0.28;
const SFX_VOLUME = 0.72;
const SYNTH_FALLBACK_VOLUME = 0.24;

type SfxKey =
  | "turret_gear"
  | "cannon_fire"
  | "shell_whistle"
  | "explosion_terrain"
  | "explosion_tank"
  | "item_select"
  | "victory"
  | "defeat";

const SFX_URLS: Record<SfxKey, string> = {
  turret_gear: sfxTurretGearUrl,
  cannon_fire: sfxCannonFireUrl,
  shell_whistle: sfxShellWhistleUrl,
  explosion_terrain: sfxExplosionTerrainUrl,
  explosion_tank: sfxExplosionTankUrl,
  item_select: sfxItemSelectUrl,
  victory: sfxVictoryUrl,
  defeat: sfxDefeatUrl
};

type FlightSound = {
  sources: AudioScheduledSourceNode[];
  gain: GainNode;
};

export type TankBattleAudioController = {
  /** Call from a pointer or keyboard event to create, unlock Web Audio, and start BGM. */
  unlock(): Promise<boolean>;
  /** Resume an existing context without creating one. */
  resume(): Promise<boolean>;
  playGearCreak(intensity?: number): void;
  playLaunch(): void;
  playFlight(): void;
  stopFlight(): void;
  playTerrainExplosion(): void;
  playTankExplosion(): void;
  playItemSelect(): void;
  playVictory(): void;
  playDefeat(): void;
  toggleMute(): boolean;
  isMuted(): boolean;
  destroy(): void;
};

/**
 * Creates a Tank Battle audio controller powered by decoded stereo BGM & WAV SFX
 * buffers with separate master/BGM/SFX gain buses, localStorage mute persistence,
 * document-visibility pause/resume, and automatic synthesized Web Audio fallback.
 */
export function createTankBattleAudio(): TankBattleAudioController {
  let context: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let bgmGain: GainNode | null = null;
  let sfxGain: GainNode | null = null;
  let synthGain: GainNode | null = null;

  const sfxBuffers = new Map<SfxKey, AudioBuffer>();
  let bgmBuffer: AudioBuffer | null = null;
  let bgmSource: AudioBufferSourceNode | null = null;
  let loadingPromise: Promise<void> | null = null;
  let flight: FlightSound | null = null;
  let muted = readStoredMute();
  let pausedByVisibility = false;
  let destroyed = false;
  const activeSources = new Set<AudioScheduledSourceNode>();

  function applyMasterGain(): void {
    if (!masterGain || !context || context.state === "closed") return;
    safely(() => {
      const target = muted ? 0 : 1;
      masterGain!.gain.cancelScheduledValues(context!.currentTime);
      masterGain!.gain.setTargetAtTime(target, context!.currentTime, 0.02);
    });
  }

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
      bgmGain = context.createGain();
      sfxGain = context.createGain();
      synthGain = context.createGain();

      masterGain.gain.setValueAtTime(muted ? 0 : 1, context.currentTime);
      bgmGain.gain.setValueAtTime(BGM_VOLUME, context.currentTime);
      sfxGain.gain.setValueAtTime(SFX_VOLUME, context.currentTime);
      synthGain.gain.setValueAtTime(SYNTH_FALLBACK_VOLUME, context.currentTime);

      bgmGain.connect(masterGain);
      sfxGain.connect(masterGain);
      synthGain.connect(masterGain);
      masterGain.connect(context.destination);
      return context;
    } catch {
      context = null;
      masterGain = null;
      bgmGain = null;
      sfxGain = null;
      synthGain = null;
      return null;
    }
  }

  async function decodeAudioUrl(audioContext: AudioContext, url: string): Promise<AudioBuffer | null> {
    if (typeof fetch !== "function") return null;
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      return await audioContext.decodeAudioData(bytes);
    } catch {
      return null;
    }
  }

  function ensureBuffersLoading(audioContext: AudioContext): Promise<void> {
    if (loadingPromise) return loadingPromise;
    loadingPromise = (async () => {
      const [decodedBgm] = await Promise.all([
        decodeAudioUrl(audioContext, bgmTankBattleUrl),
        ...(Object.entries(SFX_URLS) as Array<[SfxKey, string]>).map(async ([key, url]) => {
          const buf = await decodeAudioUrl(audioContext, url);
          if (buf && !destroyed) sfxBuffers.set(key, buf);
        })
      ]);
      if (decodedBgm && !destroyed) {
        bgmBuffer = decodedBgm;
        startBgmIfReady();
      }
    })();
    return loadingPromise;
  }

  function startBgmIfReady(): void {
    if (destroyed || pausedByVisibility || bgmSource || !bgmBuffer || !context || !bgmGain) return;
    if (context.state !== "running") return;
    safely(() => {
      const src = context!.createBufferSource();
      src.buffer = bgmBuffer;
      src.loop = true;
      src.connect(bgmGain!);
      src.start(0);
      bgmSource = src;
    });
  }

  function stopBgm(): void {
    if (!bgmSource) return;
    const current = bgmSource;
    bgmSource = null;
    safely(() => current.stop());
    safelyDisconnect(current);
  }

  async function resumeContext(audioContext: AudioContext | null): Promise<boolean> {
    if (!audioContext || destroyed || audioContext.state === "closed") return false;
    if (isDocumentHidden()) return false;
    try {
      if (audioContext.state === "suspended") await audioContext.resume();
      const running = audioContext.state === "running";
      if (running) {
        void ensureBuffersLoading(audioContext);
        startBgmIfReady();
      }
      return running;
    } catch {
      return false;
    }
  }

  function runningContext(): AudioContext | null {
    if (destroyed || muted || pausedByVisibility || !context || context.state !== "running") return null;
    return context;
  }

  function trackSource<T extends AudioScheduledSourceNode>(source: T, ...nodes: AudioNode[]): T {
    activeSources.add(source);
    source.addEventListener("ended", () => {
      activeSources.delete(source);
      safelyDisconnect(source, ...nodes);
    }, { once: true });
    return source;
  }

  function playDecodedSfx(
    key: SfxKey,
    options: { rate?: number; jitter?: number; volume?: number } = {}
  ): boolean {
    const audioContext = runningContext();
    if (!audioContext || !sfxGain) return false;
    const buffer = sfxBuffers.get(key);
    if (!buffer) return false;

    let played = false;
    safely(() => {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      const baseRate = options.rate ?? 1;
      const jitter = options.jitter ?? 0.04;
      const rate = jitter > 0 ? baseRate * (1 + (Math.random() * 2 - 1) * jitter) : baseRate;
      source.playbackRate.setValueAtTime(clamp(rate, 0.5, 2.0), audioContext.currentTime);

      if (options.volume !== undefined && options.volume !== 1) {
        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(clamp(options.volume, 0, 2), audioContext.currentTime);
        source.connect(gain);
        gain.connect(sfxGain!);
        trackSource(source, gain);
      } else {
        source.connect(sfxGain!);
        trackSource(source);
      }
      source.start(0);
      played = true;
    });
    return played;
  }

  function playGearCreak(intensity = 0.5): void {
    const amount = clamp(intensity, 0, 1);
    if (playDecodedSfx("turret_gear", { rate: 0.92 + amount * 0.28, jitter: 0.04, volume: 0.55 + amount * 0.35 })) {
      return;
    }
    const audioContext = runningContext();
    if (!audioContext || !synthGain) return;

    safely(() => {
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
      gain.connect(synthGain!);
      trackSource(oscillator, filter, gain);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    });
  }

  function playLaunch(): void {
    stopFlight();
    if (playDecodedSfx("cannon_fire", { jitter: 0.05, volume: 0.95 })) return;

    const audioContext = runningContext();
    if (!audioContext || !synthGain) return;
    safely(() => {
      const now = audioContext.currentTime;
      playNoiseBurst(audioContext, synthGain!, {
        start: now,
        duration: 0.24,
        filterType: "lowpass",
        startFrequency: 1_700,
        endFrequency: 240,
        peakGain: 0.13
      });
      playOscillatorSweep(audioContext, synthGain!, {
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
    if (!audioContext || flight) return;

    const whistleBuf = sfxBuffers.get("shell_whistle");
    if (whistleBuf && sfxGain) {
      safely(() => {
        const now = audioContext.currentTime;
        const source = audioContext.createBufferSource();
        const flightGain = audioContext.createGain();
        source.buffer = whistleBuf;
        source.loop = true;
        source.playbackRate.setValueAtTime(0.95, now);
        source.playbackRate.linearRampToValueAtTime(1.16, now + 1.3);
        flightGain.gain.setValueAtTime(SILENCE, now);
        flightGain.gain.exponentialRampToValueAtTime(0.42, now + 0.08);
        source.connect(flightGain);
        flightGain.connect(sfxGain!);
        trackSource(source, flightGain);
        flight = { sources: [source], gain: flightGain };
        source.start(now);
      });
      return;
    }

    if (!synthGain) return;
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
      flightGain.connect(synthGain!);

      const connectedNodes = [noiseFilter, noiseGain, toneFilter, toneGain, flightGain];
      trackSource(source, ...connectedNodes);
      trackSource(oscillator, ...connectedNodes);
      flight = { sources: [source, oscillator], gain: flightGain };
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
      for (const source of currentFlight.sources) {
        source.stop(end + 0.02);
      }
    });
  }

  function playTerrainExplosion(): void {
    stopFlight();
    if (playDecodedSfx("explosion_terrain", { jitter: 0.06, volume: 0.96 })) return;
    playSynthExplosion({ noiseGain: 0.2, toneGain: 0.1, startFrequency: 105, duration: 0.48 });
  }

  function playTankExplosion(): void {
    stopFlight();
    if (playDecodedSfx("explosion_tank", { jitter: 0.05, volume: 1.0 })) return;

    const audioContext = runningContext();
    if (!audioContext || !synthGain) return;
    playSynthExplosion({ noiseGain: 0.26, toneGain: 0.16, startFrequency: 82, duration: 0.72 });
    safely(() => {
      const now = audioContext.currentTime + 0.055;
      playNoiseBurst(audioContext, synthGain!, {
        start: now,
        duration: 0.38,
        filterType: "bandpass",
        startFrequency: 2_800,
        endFrequency: 620,
        peakGain: 0.075
      });
    });
  }

  function playItemSelect(): void {
    if (playDecodedSfx("item_select", { jitter: 0.03, volume: 0.8 })) return;
    const audioContext = runningContext();
    if (!audioContext || !synthGain) return;
    safely(() => {
      const now = audioContext.currentTime;
      playOscillatorSweep(audioContext, synthGain!, {
        start: now,
        duration: 0.12,
        type: "triangle",
        startFrequency: 780,
        endFrequency: 1_175,
        peakGain: 0.08
      });
    });
  }

  function playVictory(): void {
    stopFlight();
    if (playDecodedSfx("victory", { jitter: 0, volume: 0.95 })) return;
    const audioContext = runningContext();
    if (!audioContext || !synthGain) return;
    safely(() => {
      const now = audioContext.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        playOscillatorSweep(audioContext, synthGain!, {
          start: now + idx * 0.12,
          duration: idx === notes.length - 1 ? 0.5 : 0.16,
          type: "sawtooth",
          startFrequency: freq,
          endFrequency: freq,
          peakGain: 0.07
        });
      });
    });
  }

  function playDefeat(): void {
    stopFlight();
    if (playDecodedSfx("defeat", { jitter: 0, volume: 0.92 })) return;
    const audioContext = runningContext();
    if (!audioContext || !synthGain) return;
    safely(() => {
      const now = audioContext.currentTime;
      const notes = [392, 349.23, 311.13, 261.63];
      notes.forEach((freq, idx) => {
        playOscillatorSweep(audioContext, synthGain!, {
          start: now + idx * 0.18,
          duration: idx === notes.length - 1 ? 0.55 : 0.2,
          type: "sawtooth",
          startFrequency: freq,
          endFrequency: freq * 0.98,
          peakGain: 0.065
        });
      });
    });
  }

  function playSynthExplosion(options: {
    noiseGain: number;
    toneGain: number;
    startFrequency: number;
    duration: number;
  }): void {
    const audioContext = runningContext();
    if (!audioContext || !synthGain) return;

    safely(() => {
      const now = audioContext.currentTime;
      playNoiseBurst(audioContext, synthGain!, {
        start: now,
        duration: options.duration,
        filterType: "lowpass",
        startFrequency: 1_350,
        endFrequency: 110,
        peakGain: options.noiseGain
      });
      playOscillatorSweep(audioContext, synthGain!, {
        start: now,
        duration: options.duration * 0.7,
        type: "sine",
        startFrequency: options.startFrequency,
        endFrequency: 28,
        peakGain: options.toneGain
      });
    });
  }

  function toggleMute(): boolean {
    muted = !muted;
    writeStoredMute(muted);
    if (muted) stopFlight();
    applyMasterGain();
    return muted;
  }

  function isMuted(): boolean {
    return muted;
  }

  function handleVisibilityChange(): void {
    if (destroyed || !context || context.state === "closed") return;
    if (isDocumentHidden()) {
      pausedByVisibility = true;
      stopFlight();
      if (context.state === "running") {
        void context.suspend().catch(() => undefined);
      }
    } else {
      pausedByVisibility = false;
      if (context.state === "suspended") {
        void context.resume().then(() => startBgmIfReady()).catch(() => undefined);
      }
    }
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    stopFlight();
    stopBgm();

    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    }

    for (const source of activeSources) {
      safely(() => source.stop());
      safelyDisconnect(source);
    }
    activeSources.clear();
    safelyDisconnect(bgmGain, sfxGain, synthGain, masterGain);
    const audioContext = context;
    context = null;
    masterGain = null;
    bgmGain = null;
    sfxGain = null;
    synthGain = null;
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
    playItemSelect,
    playVictory,
    playDefeat,
    toggleMute,
    isMuted,
    destroy
  };
}

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && Boolean(document.hidden);
}

function readStoredMute(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(TANK_BATTLE_MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredMute(value: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TANK_BATTLE_MUTE_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage may be disabled in private browsing or sandboxed contexts.
  }
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
