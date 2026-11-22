import bgmIndianPokerUrl from "./assets/audio/bgm_indian_poker.mp3?url";
import sfxDealUrl from "./assets/audio/sfx_deal.wav?url";
import sfxChipSingleUrl from "./assets/audio/sfx_chip_single.wav?url";
import sfxChipStackUrl from "./assets/audio/sfx_chip_stack.wav?url";
import sfxAllInUrl from "./assets/audio/sfx_all_in.wav?url";
import sfxCheckUrl from "./assets/audio/sfx_check.wav?url";
import sfxFoldUrl from "./assets/audio/sfx_fold.wav?url";
import sfxRevealUrl from "./assets/audio/sfx_reveal.wav?url";
import sfxPotWinUrl from "./assets/audio/sfx_pot_win.wav?url";
import sfxRoundLoseUrl from "./assets/audio/sfx_round_lose.wav?url";
import sfxMatchWinUrl from "./assets/audio/sfx_match_win.wav?url";

export const INDIAN_POKER_MUTE_STORAGE_KEY = "bighouse:indian-poker:muted";

export type IndianPokerSfxKey =
  | "sfx_deal"
  | "sfx_chip_single"
  | "sfx_chip_stack"
  | "sfx_all_in"
  | "sfx_check"
  | "sfx_fold"
  | "sfx_reveal"
  | "sfx_pot_win"
  | "sfx_round_lose"
  | "sfx_match_win";

export type IndianPokerBgmKey = "bgm_indian_poker";

const SFX_URLS: Record<IndianPokerSfxKey, string> = {
  sfx_deal: sfxDealUrl,
  sfx_chip_single: sfxChipSingleUrl,
  sfx_chip_stack: sfxChipStackUrl,
  sfx_all_in: sfxAllInUrl,
  sfx_check: sfxCheckUrl,
  sfx_fold: sfxFoldUrl,
  sfx_reveal: sfxRevealUrl,
  sfx_pot_win: sfxPotWinUrl,
  sfx_round_lose: sfxRoundLoseUrl,
  sfx_match_win: sfxMatchWinUrl
};

const BGM_URLS: Record<IndianPokerBgmKey, string> = {
  bgm_indian_poker: bgmIndianPokerUrl
};

function readPersistedMute(): boolean {
  try {
    if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) return false;
    return globalThis.localStorage.getItem(INDIAN_POKER_MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePersistedMute(muted: boolean): void {
  try {
    if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) return;
    globalThis.localStorage.setItem(INDIAN_POKER_MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

export class IndianPokerAudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private sfxBuffers = new Map<IndianPokerSfxKey, AudioBuffer>();
  private bgmBuffers = new Map<IndianPokerBgmKey, AudioBuffer>();
  private currentBgm: AudioBufferSourceNode | null = null;
  private currentBgmKey: IndianPokerBgmKey | null = null;
  private desiredBgm: { key: IndianPokerBgmKey; loop: boolean } | null = {
    key: "bgm_indian_poker",
    loop: true
  };
  private loadingPromise: Promise<void> | null = null;
  private destroyed = false;
  private unlocked = false;
  private visibilityListener: (() => void) | null = null;
  public muted: boolean;

  constructor() {
    this.muted = readPersistedMute();
    if (typeof document !== "undefined") {
      this.visibilityListener = () => {
        this.handleVisibilityChange();
      };
      document.addEventListener("visibilitychange", this.visibilityListener);
    }
  }

  private handleVisibilityChange(): void {
    if (!this.ctx || this.destroyed) return;
    if (typeof document !== "undefined" && document.hidden) {
      if (this.ctx.state === "running") {
        void this.ctx.suspend().catch(() => undefined);
      }
    } else if (this.unlocked && !this.muted && this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
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
    if (ctx.state === "suspended" && (typeof document === "undefined" || !document.hidden)) {
      try {
        await ctx.resume();
      } catch {
        // Ignore browser gesture requirement until next interaction
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
    if (!this.ctx || typeof fetch !== "function") return;
    const ctx = this.ctx;
    const decode = async (url: string): Promise<AudioBuffer> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Audio fetch failed ${res.status}`);
      return await ctx.decodeAudioData(await res.arrayBuffer());
    };

    await Promise.all([
      ...(Object.entries(SFX_URLS) as [IndianPokerSfxKey, string][]).map(async ([key, url]) => {
        try {
          this.sfxBuffers.set(key, await decode(url));
        } catch {
          // Ignore individual decode failure in headless/restricted environments
        }
      }),
      ...(Object.entries(BGM_URLS) as [IndianPokerBgmKey, string][]).map(async ([key, url]) => {
        try {
          this.bgmBuffers.set(key, await decode(url));
        } catch {
          // Ignore individual decode failure
        }
      })
    ]);
  }

  playBgm(key: IndianPokerBgmKey, loop = true): void {
    this.desiredBgm = { key, loop };
    if (this.destroyed || !this.ctx || !this.bgmBuffers.has(key)) return;
    if (this.currentBgmKey === key) return;
    this.startBgmNow(key, loop);
  }

  private startBgmNow(key: IndianPokerBgmKey, loop: boolean): void {
    this.stopBgm();
    const buf = this.bgmBuffers.get(key);
    if (!buf || !this.ctx || !this.bgmGain || this.destroyed) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(this.bgmGain);
    src.start(0);
    this.currentBgm = src;
    this.currentBgmKey = key;
  }

  stopBgm(): void {
    if (!this.currentBgm) return;
    try {
      this.currentBgm.stop();
      this.currentBgm.disconnect();
    } catch {
      // Ignore already stopped
    }
    this.currentBgm = null;
    this.currentBgmKey = null;
  }

  playSfx(key: IndianPokerSfxKey, jitter = 0.045): void {
    if (this.destroyed || this.muted || !this.ctx || this.ctx.state !== "running" || !this.sfxGain) {
      return;
    }
    const buf = this.sfxBuffers.get(key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    if (jitter > 0) {
      src.playbackRate.value = 1 + (Math.random() * 2 - 1) * jitter;
    }
    src.connect(this.sfxGain);
    src.start(0);
  }

  setMuted(muted: boolean): boolean {
    this.muted = muted;
    writePersistedMute(this.muted);
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
    if (this.visibilityListener && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityListener);
      this.visibilityListener = null;
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
