import bgmChessUrl from "./assets/audio/bgm_chess.mp3?url";
import sfxSelectUrl from "./assets/audio/sfx_select.wav?url";
import sfxMoveUrl from "./assets/audio/sfx_move.wav?url";
import sfxCaptureUrl from "./assets/audio/sfx_capture.wav?url";
import sfxCastleUrl from "./assets/audio/sfx_castle.wav?url";
import sfxCheckUrl from "./assets/audio/sfx_check.wav?url";
import sfxPromoteUrl from "./assets/audio/sfx_promote.wav?url";
import sfxLowTimeUrl from "./assets/audio/sfx_low_time.wav?url";
import sfxWinUrl from "./assets/audio/sfx_win.wav?url";
import sfxLoseUrl from "./assets/audio/sfx_lose.wav?url";
import sfxDrawUrl from "./assets/audio/sfx_draw.wav?url";

export const CHESS_MUTE_STORAGE_KEY = "bighouse:chess:muted";

export type ChessSfxKey =
  | "sfx_select"
  | "sfx_move"
  | "sfx_capture"
  | "sfx_castle"
  | "sfx_check"
  | "sfx_promote"
  | "sfx_low_time"
  | "sfx_win"
  | "sfx_lose"
  | "sfx_draw";

export type ChessBgmKey = "bgm_chess";

const SFX_URLS: Record<ChessSfxKey, string> = {
  sfx_select: sfxSelectUrl,
  sfx_move: sfxMoveUrl,
  sfx_capture: sfxCaptureUrl,
  sfx_castle: sfxCastleUrl,
  sfx_check: sfxCheckUrl,
  sfx_promote: sfxPromoteUrl,
  sfx_low_time: sfxLowTimeUrl,
  sfx_win: sfxWinUrl,
  sfx_lose: sfxLoseUrl,
  sfx_draw: sfxDrawUrl
};

const BGM_URLS: Record<ChessBgmKey, string> = {
  bgm_chess: bgmChessUrl
};

type AudioContextCtor = new () => AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

function readPersistedMute(): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    return window.localStorage.getItem(CHESS_MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePersistedMute(muted: boolean): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(CHESS_MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Ignore storage errors in restricted/private environments
  }
}

export class ChessAudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private sfxBuffers = new Map<ChessSfxKey, AudioBuffer>();
  private bgmBuffers = new Map<ChessBgmKey, AudioBuffer>();
  private currentBgm: AudioBufferSourceNode | null = null;
  private currentBgmKey: ChessBgmKey | null = null;
  private desiredBgm: { key: ChessBgmKey; loop: boolean } | null = {
    key: "bgm_chess",
    loop: true
  };
  private loadingPromise: Promise<void> | null = null;
  private destroyed = false;
  private unlocked = false;
  public muted: boolean;

  private readonly handleVisibilityChange = (): void => {
    if (!this.ctx || this.destroyed) return;
    if (typeof document !== "undefined" && document.hidden) {
      if (this.ctx.state === "running") {
        void this.ctx.suspend().catch(() => undefined);
      }
      return;
    }
    if (this.unlocked && !this.muted && this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }
  };

  constructor() {
    this.muted = readPersistedMute();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.destroyed) return null;
    if (this.ctx) return this.ctx;
    const AudioCtx = resolveAudioContextCtor();
    if (!AudioCtx) return null;
    try {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.bgmGain = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.28;
      this.sfxGain.gain.value = 0.78;
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.bgmGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      return this.ctx;
    } catch {
      this.ctx = null;
      return null;
    }
  }

  async unlock(): Promise<void> {
    if (this.destroyed) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.unlocked = true;
    if (ctx.state === "suspended" && (typeof document === "undefined" || !document.hidden)) {
      try {
        await ctx.resume();
      } catch {
        // Ignore gesture requirement until next tap/key
      }
    }
    if (!this.loadingPromise) {
      this.loadingPromise = this.loadBuffers();
    }
    await this.loadingPromise;
    if (this.destroyed) return;
    if (this.desiredBgm && this.currentBgmKey !== this.desiredBgm.key) {
      this.startBgmNow(this.desiredBgm.key, this.desiredBgm.loop);
    }
  }

  private async loadBuffers(): Promise<void> {
    if (!this.ctx || typeof fetch !== "function") return;
    const ctx = this.ctx;
    const decode = async (url: string): Promise<AudioBuffer> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Audio fetch failed ${res.status}`);
      return await ctx.decodeAudioData(await res.arrayBuffer());
    };
    await Promise.all([
      ...(Object.entries(SFX_URLS) as Array<[ChessSfxKey, string]>).map(async ([key, url]) => {
        try {
          this.sfxBuffers.set(key, await decode(url));
        } catch {
          // Ignore individual decode failure in headless/restricted environments
        }
      }),
      ...(Object.entries(BGM_URLS) as Array<[ChessBgmKey, string]>).map(async ([key, url]) => {
        try {
          this.bgmBuffers.set(key, await decode(url));
        } catch {
          // Ignore individual decode failure
        }
      })
    ]);
  }

  playBgm(key: ChessBgmKey = "bgm_chess", loop = true): void {
    if (this.destroyed) return;
    this.desiredBgm = { key, loop };
    if (!this.ctx || !this.bgmBuffers.has(key)) return;
    if (this.currentBgmKey === key) return;
    this.startBgmNow(key, loop);
  }

  private startBgmNow(key: ChessBgmKey, loop: boolean): void {
    this.stopBgm();
    const buf = this.bgmBuffers.get(key);
    if (!buf || !this.ctx || !this.bgmGain) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      src.connect(this.bgmGain);
      src.start(0);
      this.currentBgm = src;
      this.currentBgmKey = key;
    } catch {
      // Ignore start failures
    }
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

  playSfx(key: ChessSfxKey, jitter = 0.04): void {
    if (this.destroyed || this.muted || !this.ctx || this.ctx.state !== "running" || !this.sfxGain) {
      return;
    }
    const buf = this.sfxBuffers.get(key);
    if (!buf) return;
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      if (jitter > 0) {
        src.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;
      }
      src.connect(this.sfxGain);
      src.start(0);
    } catch {
      // Ignore playback failure
    }
  }

  setMuted(nextMuted: boolean): boolean {
    this.muted = nextMuted;
    writePersistedMute(this.muted);
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
      } catch {
        this.masterGain.gain.value = this.muted ? 0 : 1;
      }
    }
    if (!this.muted && this.unlocked && this.ctx && this.ctx.state === "suspended") {
      if (typeof document === "undefined" || !document.hidden) {
        void this.ctx.resume().catch(() => undefined);
      }
    }
    return this.muted;
  }

  toggleMute(): boolean {
    return this.setMuted(!this.muted);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.stopBgm();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
