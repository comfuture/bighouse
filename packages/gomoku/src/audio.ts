import bgmGomokuUrl from "./assets/audio/bgm_gomoku.mp3?url";
import sfxDrawUrl from "./assets/audio/sfx_draw.wav?url";
import sfxForbiddenUrl from "./assets/audio/sfx_forbidden.wav?url";
import sfxLoseUrl from "./assets/audio/sfx_lose.wav?url";
import sfxStonePlaceUrl from "./assets/audio/sfx_stone_place.wav?url";
import sfxTurnChimeUrl from "./assets/audio/sfx_turn_chime.wav?url";
import sfxWinUrl from "./assets/audio/sfx_win.wav?url";

export const GOMOKU_MUTE_STORAGE_KEY = "bighouse:gomoku:muted";

export type GomokuSfxKey =
  | "sfx_stone_place"
  | "sfx_turn_chime"
  | "sfx_forbidden"
  | "sfx_win"
  | "sfx_lose"
  | "sfx_draw";

export type GomokuBgmKey = "bgm_gomoku";

const SFX_URLS: Record<GomokuSfxKey, string> = {
  sfx_stone_place: sfxStonePlaceUrl,
  sfx_turn_chime: sfxTurnChimeUrl,
  sfx_forbidden: sfxForbiddenUrl,
  sfx_win: sfxWinUrl,
  sfx_lose: sfxLoseUrl,
  sfx_draw: sfxDrawUrl
};

const BGM_URLS: Record<GomokuBgmKey, string> = {
  bgm_gomoku: bgmGomokuUrl
};

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type GomokuAudioOptions = {
  storage?: StorageLike | null;
  storageKey?: string;
};

function resolveDefaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Storage access blocked (private mode / sandbox)
  }
  return null;
}

function resolveAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
  return ctor ?? null;
}

/**
 * Web Audio manager for Gomoku BGM and tactile SFX.
 * Modeled on SunnyAudioManager with persistent mute state, document visibility
 * auto-suspend/resume, pitch jitter on stone placement, and safe headless no-op behavior.
 */
export class GomokuAudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private sfxBuffers = new Map<GomokuSfxKey, AudioBuffer>();
  private bgmBuffers = new Map<GomokuBgmKey, AudioBuffer>();
  private currentBgm: AudioBufferSourceNode | null = null;
  private currentBgmKey: GomokuBgmKey | null = null;
  private desiredBgm: { key: GomokuBgmKey; loop: boolean } | null = { key: "bgm_gomoku", loop: true };
  private loadingPromise: Promise<void> | null = null;
  private storage: StorageLike | null;
  private storageKey: string;
  private destroyed = false;
  private suspendedByVisibility = false;
  private visibilityListenerAttached = false;
  public muted = false;

  constructor(options: GomokuAudioOptions = {}) {
    this.storage = options.storage === undefined ? resolveDefaultStorage() : options.storage;
    this.storageKey = options.storageKey ?? GOMOKU_MUTE_STORAGE_KEY;
    this.muted = this.readPersistedMute();
    this.attachVisibilityListener();
  }

  private readPersistedMute(): boolean {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(this.storageKey) === "1";
    } catch {
      return false;
    }
  }

  private writePersistedMute(value: boolean): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, value ? "1" : "0");
    } catch {
      // Ignore quota / security errors
    }
  }

  private readonly onVisibilityChange = (): void => {
    if (!this.ctx || this.destroyed) return;
    if (typeof document !== "undefined" && document.hidden) {
      if (this.ctx.state === "running") {
        this.suspendedByVisibility = true;
        void this.ctx.suspend().catch(() => undefined);
      }
    } else if (this.suspendedByVisibility) {
      this.suspendedByVisibility = false;
      void this.ctx.resume().catch(() => undefined);
    }
  };

  private attachVisibilityListener(): void {
    if (this.visibilityListenerAttached || typeof document === "undefined") return;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.visibilityListenerAttached = true;
  }

  private ensureContext(): AudioContext | null {
    if (this.destroyed) return null;
    if (this.ctx) return this.ctx;
    const AudioCtx = resolveAudioContextCtor();
    if (!AudioCtx) return null;
    try {
      this.ctx = new AudioCtx();
    } catch {
      return null;
    }
    this.masterGain = this.ctx.createGain();
    this.bgmGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.28;
    this.sfxGain.gain.value = 0.72;
    this.masterGain.gain.value = this.muted ? 0 : 1;
    this.bgmGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    return this.ctx;
  }

  async unlock(): Promise<void> {
    if (this.destroyed) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended" && (typeof document === "undefined" || !document.hidden)) {
      try {
        await ctx.resume();
      } catch {
        // Ignore gesture requirement until next interaction
      }
    }
    if (!this.loadingPromise) {
      this.loadingPromise = this.loadBuffers();
    }
    await this.loadingPromise;
    if (!this.destroyed && this.desiredBgm && this.currentBgmKey !== this.desiredBgm.key) {
      this.startBgmNow(this.desiredBgm.key, this.desiredBgm.loop);
    }
  }

  private async loadBuffers(): Promise<void> {
    if (!this.ctx || typeof fetch === "undefined") return;
    const decode = async (url: string): Promise<AudioBuffer> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Audio fetch failed ${res.status}`);
      return await this.ctx!.decodeAudioData(await res.arrayBuffer());
    };

    await Promise.all([
      ...(Object.entries(SFX_URLS) as Array<[GomokuSfxKey, string]>).map(async ([k, u]) => {
        try {
          this.sfxBuffers.set(k, await decode(u));
        } catch {
          // Ignore individual decode failure
        }
      }),
      ...(Object.entries(BGM_URLS) as Array<[GomokuBgmKey, string]>).map(async ([k, u]) => {
        try {
          this.bgmBuffers.set(k, await decode(u));
        } catch {
          // Ignore individual decode failure
        }
      })
    ]);
  }

  playBgm(key: GomokuBgmKey = "bgm_gomoku", loop = true): void {
    this.desiredBgm = { key, loop };
    if (!this.ctx || !this.bgmBuffers.has(key)) return;
    if (this.currentBgmKey === key) return;
    this.startBgmNow(key, loop);
  }

  private startBgmNow(key: GomokuBgmKey, loop: boolean): void {
    this.stopBgm();
    const buf = this.bgmBuffers.get(key);
    if (!buf || !this.ctx || !this.bgmGain) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(this.bgmGain);
    src.start(0);
    this.currentBgm = src;
    this.currentBgmKey = key;
  }

  stopBgm(): void {
    if (this.currentBgm) {
      try {
        this.currentBgm.stop();
        this.currentBgm.disconnect();
      } catch {
        // Ignore already stopped
      }
      this.currentBgm = null;
      this.currentBgmKey = null;
    }
  }

  playSfx(key: GomokuSfxKey, jitter?: number): void {
    if (this.muted || this.destroyed || !this.ctx || this.ctx.state !== "running" || !this.sfxGain) {
      return;
    }
    const buf = this.sfxBuffers.get(key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const effectiveJitter = jitter ?? (key === "sfx_stone_place" ? 0.06 : 0);
    if (effectiveJitter > 0) {
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * effectiveJitter;
    }
    src.connect(this.sfxGain);
    src.start(0);
  }

  setMuted(nextMuted: boolean): boolean {
    this.muted = nextMuted;
    this.writePersistedMute(this.muted);
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  toggleMute(): boolean {
    return this.setMuted(!this.muted);
  }

  destroy(): void {
    this.destroyed = true;
    this.stopBgm();
    if (this.visibilityListenerAttached && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.visibilityListenerAttached = false;
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
  }
}
