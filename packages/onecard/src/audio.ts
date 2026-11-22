import bgmOnecardUrl from "./assets/audio/bgm_onecard.mp3?url";
import sfxCardPlayUrl from "./assets/audio/sfx_card_play.wav?url";
import sfxCardDrawUrl from "./assets/audio/sfx_card_draw.wav?url";
import sfxCardBundleUrl from "./assets/audio/sfx_card_bundle.wav?url";
import sfxAttackUrl from "./assets/audio/sfx_attack.wav?url";
import sfxReverseUrl from "./assets/audio/sfx_reverse.wav?url";
import sfxJumpUrl from "./assets/audio/sfx_jump.wav?url";
import sfxJokerUrl from "./assets/audio/sfx_joker.wav?url";
import sfxSuitPickUrl from "./assets/audio/sfx_suit_pick.wav?url";
import sfxOnecardAlertUrl from "./assets/audio/sfx_onecard_alert.wav?url";
import sfxWinUrl from "./assets/audio/sfx_win.wav?url";
import sfxLoseUrl from "./assets/audio/sfx_lose.wav?url";

export type OneCardSfxKey =
  | "sfx_card_play"
  | "sfx_card_draw"
  | "sfx_card_bundle"
  | "sfx_attack"
  | "sfx_reverse"
  | "sfx_jump"
  | "sfx_joker"
  | "sfx_suit_pick"
  | "sfx_onecard_alert"
  | "sfx_win"
  | "sfx_lose";

export type OneCardBgmKey = "bgm_onecard";

export const ONECARD_MUTE_STORAGE_KEY = "bighouse:onecard:muted";

const SFX_URLS: Record<OneCardSfxKey, string> = {
  sfx_card_play: sfxCardPlayUrl,
  sfx_card_draw: sfxCardDrawUrl,
  sfx_card_bundle: sfxCardBundleUrl,
  sfx_attack: sfxAttackUrl,
  sfx_reverse: sfxReverseUrl,
  sfx_jump: sfxJumpUrl,
  sfx_joker: sfxJokerUrl,
  sfx_suit_pick: sfxSuitPickUrl,
  sfx_onecard_alert: sfxOnecardAlertUrl,
  sfx_win: sfxWinUrl,
  sfx_lose: sfxLoseUrl
};

const BGM_URLS: Record<OneCardBgmKey, string> = {
  bgm_onecard: bgmOnecardUrl
};

export interface AudioStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getDefaultStorage(): AudioStorageLike | null {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore restricted storage environments (sandboxed iframes / private mode)
  }
  return null;
}

export class OneCardAudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private sfxBuffers = new Map<OneCardSfxKey, AudioBuffer>();
  private bgmBuffers = new Map<OneCardBgmKey, AudioBuffer>();
  private currentBgm: AudioBufferSourceNode | null = null;
  private currentBgmKey: OneCardBgmKey | null = null;
  private desiredBgm: { key: OneCardBgmKey; loop: boolean } | null = {
    key: "bgm_onecard",
    loop: true
  };
  private loadingPromise: Promise<void> | null = null;
  private storage: AudioStorageLike | null;
  private unlocked = false;
  private destroyed = false;
  private readonly handleVisibilityChange: () => void;
  public muted: boolean;

  constructor(storage?: AudioStorageLike | null) {
    this.storage = storage === undefined ? getDefaultStorage() : storage;
    this.muted = this.readMutedPreference();
    this.handleVisibilityChange = () => {
      if (this.destroyed || !this.ctx) return;
      if (typeof document !== "undefined" && document.hidden) {
        if (this.ctx.state === "running") {
          void this.ctx.suspend().catch(() => undefined);
        }
      } else if (this.unlocked && !this.muted && this.ctx.state === "suspended") {
        void this.ctx.resume().catch(() => undefined);
      }
    };
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
  }

  private readMutedPreference(): boolean {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(ONECARD_MUTE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  private writeMutedPreference(muted: boolean): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(ONECARD_MUTE_STORAGE_KEY, muted ? "1" : "0");
    } catch {
      // Ignore storage write quota/security failures
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.destroyed) return null;
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    this.sfxGain.gain.value = 0.7;
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
    this.unlocked = true;
    if (ctx.state === "suspended" && !this.muted && !(typeof document !== "undefined" && document.hidden)) {
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
    if (this.destroyed) return;
    if (this.desiredBgm && this.currentBgmKey !== this.desiredBgm.key) {
      this.startBgmNow(this.desiredBgm.key, this.desiredBgm.loop);
    }
  }

  private async loadBuffers(): Promise<void> {
    if (!this.ctx || typeof fetch !== "function") return;
    const decode = async (url: string): Promise<AudioBuffer> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Audio fetch failed ${res.status}`);
      return await this.ctx!.decodeAudioData(await res.arrayBuffer());
    };
    await Promise.all([
      ...(Object.entries(SFX_URLS) as [OneCardSfxKey, string][]).map(async ([k, u]) => {
        try {
          this.sfxBuffers.set(k, await decode(u));
        } catch {
          // Ignore individual decode failure
        }
      }),
      ...(Object.entries(BGM_URLS) as [OneCardBgmKey, string][]).map(async ([k, u]) => {
        try {
          this.bgmBuffers.set(k, await decode(u));
        } catch {
          // Ignore individual decode failure
        }
      })
    ]);
  }

  playBgm(key: OneCardBgmKey = "bgm_onecard", loop = true): void {
    this.desiredBgm = { key, loop };
    if (!this.ctx || !this.bgmBuffers.has(key)) return;
    if (this.currentBgmKey === key) return;
    this.startBgmNow(key, loop);
  }

  private startBgmNow(key: OneCardBgmKey, loop: boolean): void {
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

  playSfx(key: OneCardSfxKey, jitter = 0.05): void {
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
      // Ignore playback errors in constrained environments
    }
  }

  setMuted(muted: boolean): boolean {
    this.muted = muted;
    this.writeMutedPreference(muted);
    if (this.masterGain && this.ctx) {
      try {
        this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
      } catch {
        this.masterGain.gain.value = this.muted ? 0 : 1;
      }
      if (!this.muted && this.unlocked && this.ctx.state === "suspended" && !(typeof document !== "undefined" && document.hidden)) {
        void this.ctx.resume().catch(() => undefined);
      }
    }
    return this.muted;
  }

  toggleMute(): boolean {
    return this.setMuted(!this.muted);
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.stopBgm();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
  }
}
