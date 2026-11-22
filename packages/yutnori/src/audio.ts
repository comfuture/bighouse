import bgmYutnoriUrl from "./assets/audio/bgm_yutnori.mp3?url";
import sfxYutThrowUrl from "./assets/audio/sfx_yut_throw.wav?url";
import sfxYutBigUrl from "./assets/audio/sfx_yut_big.wav?url";
import sfxBackdoUrl from "./assets/audio/sfx_backdo.wav?url";
import sfxPieceHopUrl from "./assets/audio/sfx_piece_hop.wav?url";
import sfxCaptureUrl from "./assets/audio/sfx_capture.wav?url";
import sfxStackUrl from "./assets/audio/sfx_stack.wav?url";
import sfxFinishUrl from "./assets/audio/sfx_finish.wav?url";
import sfxVictoryUrl from "./assets/audio/sfx_victory.wav?url";
import type { Outcome, YutThrow } from "./types";

const IMPACT_FRACTIONS = [0.53, 0.67, 0.79, 0.88];

export type YutSfxKey =
  | "sfx_yut_throw"
  | "sfx_yut_big"
  | "sfx_backdo"
  | "sfx_piece_hop"
  | "sfx_capture"
  | "sfx_stack"
  | "sfx_finish"
  | "sfx_victory";

const SFX_URLS: Record<YutSfxKey, string> = {
  sfx_yut_throw: sfxYutThrowUrl,
  sfx_yut_big: sfxYutBigUrl,
  sfx_backdo: sfxBackdoUrl,
  sfx_piece_hop: sfxPieceHopUrl,
  sfx_capture: sfxCaptureUrl,
  sfx_stack: sfxStackUrl,
  sfx_finish: sfxFinishUrl,
  sfx_victory: sfxVictoryUrl
};

export type ThrowAudioController = {
  unlock(): void;
  setMuted(muted: boolean): void;
  setBgmMuted(muted: boolean): void;
  isMuted(): boolean;
  isBgmMuted(): boolean;
  play(roll: YutThrow, serverNow: number): void;
  playBgm(): void;
  stopBgm(): void;
  playOutcome(outcome: Outcome): void;
  playHop(): void;
  playCapture(): void;
  playStack(): void;
  playFinish(): void;
  playVictory(): void;
  destroy(): void;
};

/** Late listeners hear only impacts that have not happened on the shared timeline. */
export function remainingImpactDelays(roll: YutThrow, serverNow: number): number[] {
  return IMPACT_FRACTIONS.map((fraction) => roll.startedAt + roll.durationMs * fraction - serverNow).filter((delay) => delay >= 0);
}

export function createThrowAudio(initialMuted: boolean, initialBgmMuted = false): ThrowAudioController {
  let context: AudioContext | undefined;
  let bgmGain: GainNode | undefined;
  let sfxGain: GainNode | undefined;
  let bgmBuffer: AudioBuffer | undefined;
  let bgmSource: AudioBufferSourceNode | undefined;
  let bgmWanted = true;
  let loadingPromise: Promise<void> | undefined;

  let muted = initialMuted;
  let bgmMuted = initialBgmMuted;
  let destroyed = false;
  let current: YutThrow | undefined;
  let offset = 0;
  let scheduledKey = "";

  const sfxBuffers = new Map<YutSfxKey, AudioBuffer>();
  const sources = new Set<AudioScheduledSourceNode>();
  const nodes = new Set<AudioNode>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function clearTimers(): void {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function stopSfx(): void {
    clearTimers();
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        /* Already finished. */
      }
    }
    sources.clear();
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
    nodes.clear();
  }

  function stopBgmSource(): void {
    if (!bgmSource) return;
    try {
      bgmSource.stop();
      bgmSource.disconnect();
    } catch {
      /* Already stopped. */
    }
    bgmSource = undefined;
  }

  function ensureContext(): AudioContext | undefined {
    if (destroyed) return undefined;
    if (context) return context;
    if (typeof window === "undefined") return undefined;
    const AudioCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return undefined;
    try {
      context = new AudioCtor();
      bgmGain = context.createGain();
      sfxGain = context.createGain();
      bgmGain.gain.value = bgmMuted ? 0 : 0.24;
      sfxGain.gain.value = muted ? 0 : 0.72;
      bgmGain.connect(context.destination);
      sfxGain.connect(context.destination);
      return context;
    } catch {
      return undefined;
    }
  }

  async function loadBuffers(): Promise<void> {
    if (!context || typeof fetch !== "function") return;
    const ctx = context;
    const decode = async (url: string): Promise<AudioBuffer> => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
      return await ctx.decodeAudioData(await response.arrayBuffer());
    };

    const tasks: Promise<void>[] = [
      (async () => {
        try {
          bgmBuffer = await decode(bgmYutnoriUrl);
          if (!destroyed && bgmWanted && !bgmMuted && !document.hidden) startBgmNow();
        } catch {
          /* Individual decode failure never breaks gameplay. */
        }
      })(),
      ...(Object.entries(SFX_URLS) as [YutSfxKey, string][]).map(async ([key, url]) => {
        try {
          sfxBuffers.set(key, await decode(url));
        } catch {
          /* Individual decode failure falls back silently or to synth impact. */
        }
      })
    ];
    await Promise.all(tasks);
  }

  function startBgmNow(): void {
    if (destroyed || bgmMuted || !bgmWanted || !context || !bgmGain || !bgmBuffer || bgmSource) return;
    if (context.state !== "running" || (typeof document !== "undefined" && document.hidden)) return;
    try {
      const source = context.createBufferSource();
      source.buffer = bgmBuffer;
      source.loop = true;
      source.connect(bgmGain);
      source.start(0);
      bgmSource = source;
    } catch {
      bgmSource = undefined;
    }
  }

  function playBufferSfx(key: YutSfxKey, gainScale = 1, jitter = 0.04, startAt?: number): boolean {
    if (destroyed || muted || !context || !sfxGain || context.state !== "running") return false;
    if (typeof document !== "undefined" && document.hidden) return false;
    const buffer = sfxBuffers.get(key);
    if (!buffer) return false;
    try {
      const src = context.createBufferSource();
      src.buffer = buffer;
      if (jitter > 0) {
        src.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;
      }
      const g = context.createGain();
      g.gain.value = gainScale;
      src.connect(g);
      g.connect(sfxGain);
      sources.add(src);
      nodes.add(g);
      src.onended = () => {
        sources.delete(src);
        nodes.delete(g);
        try {
          src.disconnect();
          g.disconnect();
        } catch {
          /* Already disconnected. */
        }
      };
      src.start(startAt ?? context.currentTime);
      return true;
    } catch {
      return false;
    }
  }

  function impact(time: number, index: number, seed: number): void {
    if (!context || !sfxGain) return;
    const ctx = context;
    const strength = 0.7 - index * 0.1;
    // Short high-passed noise is the click; decaying resonances give it a hollow wood body.
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.035), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    let random = (seed + index * 7919) >>> 0;
    for (let i = 0; i < samples.length; i++) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      samples[i] = ((random / 0xffffffff) * 2 - 1) * (1 - i / samples.length);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1900;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.14 * strength, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    noise.connect(filter);
    filter.connect(clickGain);
    clickGain.connect(sfxGain);
    nodes.add(filter);
    nodes.add(clickGain);
    sources.add(noise);
    noise.onended = () => {
      sources.delete(noise);
      noise.disconnect();
      filter.disconnect();
      clickGain.disconnect();
      nodes.delete(filter);
      nodes.delete(clickGain);
    };
    noise.start(time);
    noise.stop(time + 0.045);

    for (const [frequency, gain] of [
      [810, 0.16],
      [1370, 0.08],
      [2340, 0.03]
    ]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency! * (1 + index * 0.025), time);
      oscillator.frequency.exponentialRampToValueAtTime(frequency! * 0.87, time + 0.09);
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(gain! * strength, time);
      envelope.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
      oscillator.connect(envelope);
      envelope.connect(sfxGain);
      nodes.add(envelope);
      sources.add(oscillator);
      oscillator.onended = () => {
        sources.delete(oscillator);
        oscillator.disconnect();
        envelope.disconnect();
        nodes.delete(envelope);
      };
      oscillator.start(time);
      oscillator.stop(time + 0.13);
    }
  }

  function playOutcome(outcome: Outcome): void {
    if (outcome === "yut" || outcome === "mo") {
      playBufferSfx("sfx_yut_big", 0.92, 0.02);
    } else if (outcome === "backDo") {
      playBufferSfx("sfx_backdo", 0.88, 0.03);
    }
  }

  function schedule(): void {
    if (!context || context.state !== "running" || !current || muted || destroyed || (typeof document !== "undefined" && document.hidden)) return;
    const key = `${current.matchId}:${current.rollId}`;
    if (key === scheduledKey) return;
    scheduledKey = key;
    const now = Date.now() + offset;
    const delays = remainingImpactDelays(current, now);
    if (delays.length === 4) {
      // Layer subtle tumbling clatter SFX right as the first stick approaches the straw mat
      playBufferSfx("sfx_yut_throw", 0.72, 0.04, context.currentTime + Math.max(0, (delays[0]! - 120) / 1000));
    }
    delays.forEach((delay, index) => impact(context!.currentTime + delay / 1000, index, current!.visualSeed));

    // Schedule outcome celebration/sting right as the sticks settle
    const finishDelay = current.startedAt + current.durationMs - now;
    if (finishDelay >= 0 && (current.outcome === "yut" || current.outcome === "mo" || current.outcome === "backDo")) {
      const outcome = current.outcome;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!destroyed && !muted) playOutcome(outcome);
      }, finishDelay);
      timers.add(timer);
    }
  }

  const onVisibility = (): void => {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      stopSfx();
      stopBgmSource();
      if (context && context.state === "running") {
        void context.suspend().catch(() => undefined);
      }
    } else if (!destroyed && context && (!muted || !bgmMuted)) {
      void context.resume().then(() => {
        if (!bgmMuted && bgmWanted) startBgmNow();
      }).catch(() => undefined);
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  return {
    unlock() {
      if (destroyed || (muted && bgmMuted)) return;
      const ctx = ensureContext();
      if (!ctx) return;
      if (!loadingPromise) {
        loadingPromise = loadBuffers();
      }
      try {
        void ctx
          .resume()
          .then(() => {
            if (!destroyed) {
              schedule();
              if (!bgmMuted && bgmWanted) startBgmNow();
            }
          })
          .catch(() => undefined);
      } catch {
        /* Playback requires browser/user activation; silence remains a valid fallback. */
      }
    },
    setMuted(value: boolean) {
      muted = value;
      if (sfxGain && context) {
        sfxGain.gain.setTargetAtTime(muted ? 0 : 0.72, context.currentTime, 0.02);
      }
      if (muted) stopSfx();
    },
    setBgmMuted(value: boolean) {
      bgmMuted = value;
      if (bgmGain && context) {
        bgmGain.gain.setTargetAtTime(bgmMuted ? 0 : 0.24, context.currentTime, 0.04);
      }
      if (bgmMuted) {
        stopBgmSource();
      } else if (bgmWanted) {
        this.unlock();
        startBgmNow();
      }
    },
    isMuted() {
      return muted;
    },
    isBgmMuted() {
      return bgmMuted;
    },
    play(roll, serverNow) {
      if (destroyed) return;
      if (current?.matchId === roll.matchId && current.rollId === roll.rollId) return;
      stopSfx();
      current = roll;
      offset = serverNow - Date.now();
      schedule();
    },
    playBgm() {
      bgmWanted = true;
      if (!bgmMuted) {
        startBgmNow();
      }
    },
    stopBgm() {
      bgmWanted = false;
      stopBgmSource();
    },
    playOutcome,
    playHop() {
      playBufferSfx("sfx_piece_hop", 0.75, 0.07);
    },
    playCapture() {
      playBufferSfx("sfx_capture", 0.95, 0.03);
    },
    playStack() {
      playBufferSfx("sfx_stack", 0.88, 0.03);
    },
    playFinish() {
      playBufferSfx("sfx_finish", 0.92, 0.02);
    },
    playVictory() {
      playBufferSfx("sfx_victory", 0.95, 0.0);
    },
    destroy() {
      destroyed = true;
      stopSfx();
      stopBgmSource();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      void context?.close().catch(() => undefined);
    }
  };
}
