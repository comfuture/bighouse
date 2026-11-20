import bgmStage1Url from "./assets/audio/bgm_stage1.mp3?url";
import bgmClearUrl from "./assets/audio/bgm_clear.mp3?url";
import sfxJumpUrl from "./assets/audio/sfx_jump.wav?url";
import sfxLandUrl from "./assets/audio/sfx_land.wav?url";
import sfxAttackSwordUrl from "./assets/audio/sfx_attack_sword.wav?url";
import sfxAttackStaffUrl from "./assets/audio/sfx_attack_staff.wav?url";
import sfxHitUrl from "./assets/audio/sfx_hit.wav?url";
import sfxCritUrl from "./assets/audio/sfx_crit.wav?url";
import sfxMobDefeatUrl from "./assets/audio/sfx_mob_defeat.wav?url";
import sfxPlayerHurtUrl from "./assets/audio/sfx_player_hurt.wav?url";
import sfxItemPickupUrl from "./assets/audio/sfx_item_pickup.wav?url";
import sfxPotionUrl from "./assets/audio/sfx_potion.wav?url";
import sfxPortalUrl from "./assets/audio/sfx_portal.wav?url";
import sfxLadderUrl from "./assets/audio/sfx_ladder.wav?url";
import sfxLevelUpUrl from "./assets/audio/sfx_level_up.wav?url";

const SFX_URLS: Record<string, string> = {
  sfx_jump: sfxJumpUrl,
  sfx_land: sfxLandUrl,
  sfx_attack_sword: sfxAttackSwordUrl,
  sfx_attack_staff: sfxAttackStaffUrl,
  sfx_hit: sfxHitUrl,
  sfx_crit: sfxCritUrl,
  sfx_mob_defeat: sfxMobDefeatUrl,
  sfx_player_hurt: sfxPlayerHurtUrl,
  sfx_item_pickup: sfxItemPickupUrl,
  sfx_potion: sfxPotionUrl,
  sfx_portal: sfxPortalUrl,
  sfx_ladder: sfxLadderUrl,
  sfx_level_up: sfxLevelUpUrl
};

const BGM_URLS: Record<string, string> = {
  bgm_stage1: bgmStage1Url,
  bgm_clear: bgmClearUrl
};

export class SunnyAudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private sfxBuffers = new Map<string, AudioBuffer>();
  private bgmBuffers = new Map<string, AudioBuffer>();
  private currentBgm: AudioBufferSourceNode | null = null;
  private currentBgmKey: string | null = null;
  private desiredBgm: { key: string; loop: boolean } | null = { key: "bgm_stage1", loop: true };
  private loadingPromise: Promise<void> | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.bgmGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.34;
    this.sfxGain.gain.value = 0.65;
    this.masterGain.gain.value = this.muted ? 0 : 1;
    this.bgmGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    return this.ctx;
  }

  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // Ignore browser gesture requirement until next tap/key
      }
    }
    if (!this.loadingPromise) {
      this.loadingPromise = this.loadBuffers();
    }
    await this.loadingPromise;
    if (this.desiredBgm && this.currentBgmKey !== this.desiredBgm.key) {
      this.startBgmNow(this.desiredBgm.key, this.desiredBgm.loop);
    }
  }

  private async loadBuffers(): Promise<void> {
    if (!this.ctx) return;
    const decode = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Audio fetch failed ${res.status}`);
      return await this.ctx!.decodeAudioData(await res.arrayBuffer());
    };
    await Promise.all([
      ...Object.entries(SFX_URLS).map(async ([k, u]) => {
        try {
          this.sfxBuffers.set(k, await decode(u));
        } catch {
          // Ignore individual decode failure
        }
      }),
      ...Object.entries(BGM_URLS).map(async ([k, u]) => {
        try {
          this.bgmBuffers.set(k, await decode(u));
        } catch {
          // Ignore individual decode failure
        }
      })
    ]);
  }

  playBgm(key: string, loop = true): void {
    this.desiredBgm = { key, loop };
    if (!this.ctx || !this.bgmBuffers.has(key)) return;
    if (this.currentBgmKey === key) return;
    this.startBgmNow(key, loop);
  }

  private startBgmNow(key: string, loop: boolean): void {
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

  playSfx(key: string, jitter = 0.05): void {
    if (this.muted || !this.ctx || this.ctx.state !== "running" || !this.sfxGain) return;
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

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  destroy(): void {
    this.stopBgm();
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
