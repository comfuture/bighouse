import playersSheetUrl from "./assets/images/players_sheet.png?url";
import chipsCardsSheetUrl from "./assets/images/chips_cards_sheet.png?url";
import {
  CHIPS_CARDS_SHEET_SPEC,
  PLAYER_SHEET_SPEC,
  createChipVolley,
  createDustMotes,
  evaluateFlyingChip,
  evaluateGamblerPose,
  evaluatePotGlow,
  stepDustMotes,
  stepFlyingChips,
  type DustMote,
  type FlyingChip,
  type GamblerAnimState
} from "./animation";

export type IndianPokerSceneState = {
  phase: "idle" | "betting" | "reveal" | "gameOver";
  pot: number;
  ante: number;
  startingChips: number;
  opponentPresent: boolean;
  opponentChips: number;
  opponentState: GamblerAnimState;
  opponentIsTurn: boolean;
  selfChips: number;
  selfState: GamblerAnimState;
  selfIsTurn: boolean;
};

type Rect = { x: number; y: number; width: number; height: number };

export type IndianPokerRendererTargets = {
  surface: HTMLElement;
  table: HTMLElement;
  opponentFigure: HTMLElement;
  selfFigure: HTMLElement;
  pot: HTMLElement;
};

const DEFAULT_SCENE: IndianPokerSceneState = {
  phase: "idle",
  pot: 0,
  ante: 5,
  startingChips: 100,
  opponentPresent: false,
  opponentChips: 0,
  opponentState: "idle",
  opponentIsTurn: false,
  selfChips: 0,
  selfState: "idle",
  selfIsTurn: false
};

export class IndianPokerCanvasRenderer {
  private readonly surface: HTMLElement;
  private readonly table: HTMLElement;
  private readonly opponentFigure: HTMLElement;
  private readonly selfFigure: HTMLElement;
  private readonly potEl: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  private playersImg: HTMLImageElement | null = null;
  private playersLoaded = false;
  private chipsImg: HTMLImageElement | null = null;
  private chipsLoaded = false;

  private scene: IndianPokerSceneState = { ...DEFAULT_SCENE };
  private width = 0;
  private height = 0;
  private dpr = 1;
  private opponentRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private selfRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private potRect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  private dustMotes: DustMote[] = [];
  private flyingChips: FlyingChip[] = [];
  private nextChipId = 1;
  private simTime = 0;

  private rafId: number | null = null;
  private lastTimestamp = 0;
  private destroyed = false;
  private docHidden = typeof document !== "undefined" ? document.hidden : false;
  private contentSkipped = false;
  private offscreen = false;
  private reducedMotion = false;

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private motionMediaQuery: MediaQueryList | null = null;

  private readonly onVisibilityChange = () => {
    this.docHidden = typeof document !== "undefined" ? document.hidden : false;
    this.syncLoopState();
  };

  private readonly onContentVisibilityChange = (event: Event) => {
    const skipped = Boolean((event as Event & { skipped?: boolean }).skipped);
    this.contentSkipped = skipped;
    this.syncLoopState();
  };

  private readonly onWindowResize = () => {
    this.measureLayout();
    this.renderFrame();
  };

  private readonly onReducedMotionChange = () => {
    this.reducedMotion = Boolean(this.motionMediaQuery?.matches);
    if (this.reducedMotion) {
      this.flyingChips = [];
    }
    this.syncLoopState();
    this.renderFrame();
  };

  constructor(targets: IndianPokerRendererTargets) {
    this.surface = targets.surface;
    this.table = targets.table;
    this.opponentFigure = targets.opponentFigure;
    this.selfFigure = targets.selfFigure;
    this.potEl = targets.pot;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "ip-fx-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.table.prepend(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.motionMediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = this.motionMediaQuery.matches;
      this.motionMediaQuery.addEventListener?.("change", this.onReducedMotionChange);
    }

    this.loadImages();
    this.attachObservers();
    this.measureLayout();
    this.renderFrame();
    this.syncLoopState();
  }

  private loadImages(): void {
    if (typeof Image === "undefined") return;

    const pImg = new Image();
    pImg.decoding = "async";
    pImg.onload = () => {
      this.playersLoaded = true;
      this.renderFrame();
    };
    pImg.src = playersSheetUrl;
    this.playersImg = pImg;

    const cImg = new Image();
    cImg.decoding = "async";
    cImg.onload = () => {
      this.chipsLoaded = true;
      this.renderFrame();
    };
    cImg.src = chipsCardsSheetUrl;
    this.chipsImg = cImg;
  }

  private attachObservers(): void {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }

    // Direct listener on the content-visibility: auto container (event may not bubble)
    this.surface.addEventListener("contentvisibilityautostatechange", this.onContentVisibilityChange);

    // Progressive fallback using IntersectionObserver when content-visibility is unsupported
    const supportsContentVisibility =
      typeof document !== "undefined" && "contentVisibility" in document.documentElement.style;
    if (!supportsContentVisibility && typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          this.offscreen = !entry.isIntersecting;
          this.syncLoopState();
        },
        { rootMargin: "120px" }
      );
      this.intersectionObserver.observe(this.surface);
    }

    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.measureLayout();
        this.renderFrame();
      });
      this.resizeObserver.observe(this.table);
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.onWindowResize);
    }
  }

  private measureRect(el: HTMLElement, origin: DOMRect): Rect {
    const r = el.getBoundingClientRect();
    return {
      x: r.left - origin.left,
      y: r.top - origin.top,
      width: r.width,
      height: r.height
    };
  }

  measureLayout(): void {
    const tableRect = this.table.getBoundingClientRect();
    const nextW = Math.max(1, Math.round(tableRect.width));
    const nextH = Math.max(1, Math.round(tableRect.height));
    const nextDpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

    const sizeChanged = nextW !== this.width || nextH !== this.height || nextDpr !== this.dpr;
    if (sizeChanged) {
      this.width = nextW;
      this.height = nextH;
      this.dpr = nextDpr;
      this.canvas.width = Math.max(1, Math.round(nextW * nextDpr));
      this.canvas.height = Math.max(1, Math.round(nextH * nextDpr));
      this.dustMotes = createDustMotes(18, nextW, nextH);
    }

    this.opponentRect = this.measureRect(this.opponentFigure, tableRect);
    this.selfRect = this.measureRect(this.selfFigure, tableRect);
    this.potRect = this.measureRect(this.potEl, tableRect);
  }

  setSceneState(next: IndianPokerSceneState): void {
    this.scene = { ...next };
    this.measureLayout();
    this.renderFrame();
    this.syncLoopState();
  }

  spawnBetChips(from: "self" | "opponent", amount: number, isAllIn = false): void {
    if (this.reducedMotion || this.destroyed) return;
    this.measureLayout();

    const seatRect = from === "self" ? this.selfRect : this.opponentRect;
    const pot = this.potRect;
    if (seatRect.width <= 0 || pot.width <= 0) return;

    const startX = seatRect.x + seatRect.width * 0.5;
    const startY = seatRect.y + seatRect.height * 0.65;
    const endX = pot.x + pot.width * 0.5;
    const endY = pot.y + pot.height * 0.5;
    const ante = Math.max(1, this.scene.ante || 5);
    const count = isAllIn ? 8 : Math.max(2, Math.min(6, Math.ceil(amount / ante) + 1));

    const volley = createChipVolley({
      startX,
      startY,
      endX,
      endY,
      count,
      startId: this.nextChipId,
      highValue: isAllIn || amount >= ante * 3,
      spreadPx: isAllIn ? 26 : 16,
      duration: isAllIn ? 0.62 : 0.48
    });
    this.nextChipId += volley.length;
    this.flyingChips = [...this.flyingChips, ...volley];
    this.syncLoopState();
  }

  spawnPotSweep(to: "self" | "opponent" | "tie", potAmount: number): void {
    if (this.reducedMotion || this.destroyed) return;
    this.measureLayout();

    const pot = this.potRect;
    if (pot.width <= 0) return;
    const startX = pot.x + pot.width * 0.5;
    const startY = pot.y + pot.height * 0.5;
    const ante = Math.max(1, this.scene.ante || 5);
    const totalCount = Math.max(4, Math.min(9, Math.ceil(potAmount / ante) + 2));

    const targets: ("self" | "opponent")[] = to === "tie" ? ["self", "opponent"] : [to];
    const perTarget = Math.max(2, Math.ceil(totalCount / targets.length));

    for (const side of targets) {
      const seatRect = side === "self" ? this.selfRect : this.opponentRect;
      if (seatRect.width <= 0) continue;
      const volley = createChipVolley({
        startX,
        startY,
        endX: seatRect.x + seatRect.width * 0.5,
        endY: seatRect.y + seatRect.height * 0.6,
        count: perTarget,
        startId: this.nextChipId,
        highValue: potAmount >= ante * 4,
        spreadPx: 22,
        duration: 0.58
      });
      this.nextChipId += volley.length;
      this.flyingChips = [...this.flyingChips, ...volley];
    }
    this.syncLoopState();
  }

  private shouldAnimate(): boolean {
    if (this.destroyed || this.docHidden || this.contentSkipped || this.offscreen) {
      return false;
    }
    if (this.reducedMotion) {
      return false;
    }
    return true;
  }

  private syncLoopState(): void {
    if (this.shouldAnimate()) {
      if (this.rafId === null && typeof requestAnimationFrame === "function") {
        this.lastTimestamp = typeof performance !== "undefined" ? performance.now() : Date.now();
        this.rafId = requestAnimationFrame(this.tick);
      }
    } else if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private readonly tick = (timestamp: number) => {
    this.rafId = null;
    if (!this.shouldAnimate()) return;

    const dt = Math.max(0, Math.min(0.05, (timestamp - this.lastTimestamp) / 1000));
    this.lastTimestamp = timestamp;
    this.simTime += dt;

    this.dustMotes = stepDustMotes(this.dustMotes, dt, this.width, this.height);
    if (this.flyingChips.length > 0) {
      this.flyingChips = stepFlyingChips(this.flyingChips, dt);
    }

    this.renderFrame();

    if (this.shouldAnimate()) {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  private renderFrame(): void {
    const ctx = this.ctx;
    if (!ctx || this.width <= 0 || this.height <= 0) return;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    const glow = evaluatePotGlow({
      pot: this.scene.pot,
      ante: this.scene.ante,
      startingChips: this.scene.startingChips,
      phase: this.scene.phase,
      time: this.simTime,
      reducedMotion: this.reducedMotion
    });

    this.drawAtmosphere(ctx, glow.glowIntensity, glow.tensionVignette);
    this.drawDustMotes(ctx);
    this.drawPotChipsAndMedallion(ctx, glow.sparkleAlpha);
    this.drawSeatChipStack(ctx, this.opponentRect, this.scene.opponentChips, "left");
    this.drawSeatChipStack(ctx, this.selfRect, this.scene.selfChips, "left");
    this.drawGambler(
      ctx,
      this.opponentRect,
      PLAYER_SHEET_SPEC.characterRows.rival,
      this.scene.opponentState,
      this.scene.opponentIsTurn,
      this.scene.opponentPresent ? 1 : 0.3,
      0
    );
    this.drawGambler(
      ctx,
      this.selfRect,
      PLAYER_SHEET_SPEC.characterRows.challenger,
      this.scene.selfState,
      this.scene.selfIsTurn,
      1,
      1.7
    );
    this.drawFlyingChips(ctx);

    ctx.restore();
  }

  private drawAtmosphere(ctx: CanvasRenderingContext2D, glowIntensity: number, tensionVignette: number): void {
    const cx = this.potRect.width > 0 ? this.potRect.x + this.potRect.width * 0.5 : this.width * 0.5;
    const cy = this.potRect.height > 0 ? this.potRect.y + this.potRect.height * 0.5 : this.height * 0.48;
    const spotRadius = Math.max(this.width, this.height) * 0.52;

    // Warm overhead lantern spotlight pool centered around the pot
    const spot = ctx.createRadialGradient(cx, cy, spotRadius * 0.05, cx, cy, spotRadius);
    spot.addColorStop(0, `rgba(255, 214, 118, ${(0.1 + glowIntensity * 0.14).toFixed(3)})`);
    spot.addColorStop(0.55, `rgba(246, 188, 76, ${(0.03 + glowIntensity * 0.04).toFixed(3)})`);
    spot.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, this.width, this.height);

    // High-stakes tension edge vignette during big pots
    if (tensionVignette > 0.02) {
      const edge = ctx.createRadialGradient(
        cx,
        cy,
        Math.min(this.width, this.height) * 0.24,
        cx,
        cy,
        Math.max(this.width, this.height) * 0.72
      );
      edge.addColorStop(0, "rgba(0, 0, 0, 0)");
      edge.addColorStop(1, `rgba(12, 4, 4, ${(tensionVignette * 0.42).toFixed(3)})`);
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawDustMotes(ctx: CanvasRenderingContext2D): void {
    for (const mote of this.dustMotes) {
      const twinkle = this.reducedMotion ? 0.7 : 0.45 + 0.55 * Math.sin(mote.twinklePhase);
      const alpha = mote.baseAlpha * twinkle;
      if (alpha <= 0.01) continue;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 228, 150, ${alpha.toFixed(3)})`;
      ctx.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGambler(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    row: 0 | 1,
    animState: GamblerAnimState,
    isTurn: boolean,
    seatAlpha: number,
    phaseOffset: number
  ): void {
    if (rect.width <= 4 || rect.height <= 4) return;

    const pose = evaluateGamblerPose(animState, this.simTime, {
      isTurn,
      reducedMotion: this.reducedMotion,
      phaseOffset
    });

    const cx = rect.x + rect.width * 0.5;
    const bottomY = rect.y + rect.height;
    const spriteSize = Math.min(rect.width * 1.06, rect.height * 1.18);

    ctx.save();
    ctx.globalAlpha = seatAlpha;

    // Warm golden spotlight halo behind active/winning gambler
    if (pose.glowAlpha > 0.05) {
      const haloR = spriteSize * 0.62;
      const haloY = bottomY - spriteSize * 0.44;
      const halo = ctx.createRadialGradient(cx, haloY, haloR * 0.14, cx, haloY, haloR);
      const haloColor =
        animState === "win"
          ? `rgba(252, 211, 77, ${(pose.glowAlpha * 0.44).toFixed(3)})`
          : animState === "tense"
            ? `rgba(248, 113, 113, ${(pose.glowAlpha * 0.3).toFixed(3)})`
            : `rgba(231, 198, 107, ${(pose.glowAlpha * 0.34).toFixed(3)})`;
      halo.addColorStop(0, haloColor);
      halo.addColorStop(1, "rgba(231, 198, 107, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, haloY, haloR, 0, Math.PI * 2);
      ctx.fill();
    }

    // Soft felt contact shadow under shoulders
    ctx.fillStyle = "rgba(4, 10, 8, 0.36)";
    ctx.beginPath();
    ctx.ellipse(cx, bottomY - 3, spriteSize * 0.38, spriteSize * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bottom-anchored volume-preserving sprite transform
    ctx.translate(cx + pose.offsetX, bottomY + pose.offsetY);
    ctx.rotate(pose.rotation);
    ctx.scale(pose.scaleX, pose.scaleY);

    if (this.playersLoaded && this.playersImg) {
      const sx = pose.frameIndex * PLAYER_SHEET_SPEC.frameWidth;
      const sy = row * PLAYER_SHEET_SPEC.frameHeight;
      ctx.drawImage(
        this.playersImg,
        sx,
        sy,
        PLAYER_SHEET_SPEC.frameWidth,
        PLAYER_SHEET_SPEC.frameHeight,
        -spriteSize * 0.5,
        -spriteSize,
        spriteSize,
        spriteSize
      );
    } else {
      // Tasteful soft bust placeholder while image decodes
      ctx.fillStyle = "rgba(12, 24, 20, 0.72)";
      ctx.beginPath();
      ctx.arc(0, -spriteSize * 0.62, spriteSize * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, -spriteSize * 0.16, spriteSize * 0.36, spriteSize * 0.2, 0, Math.PI, 0);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawChipSprite(
    ctx: CanvasRenderingContext2D,
    cellIndex: number,
    cx: number,
    cy: number,
    size: number,
    rotation = 0,
    alpha = 1
  ): void {
    if (!this.chipsLoaded || !this.chipsImg) return;
    const sx = cellIndex * CHIPS_CARDS_SHEET_SPEC.frameWidth;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    if (rotation !== 0) ctx.rotate(rotation);
    ctx.drawImage(
      this.chipsImg,
      sx,
      0,
      CHIPS_CARDS_SHEET_SPEC.frameWidth,
      CHIPS_CARDS_SHEET_SPEC.frameHeight,
      -size * 0.5,
      -size * 0.5,
      size,
      size
    );
    ctx.restore();
  }

  private drawPotChipsAndMedallion(ctx: CanvasRenderingContext2D, sparkleAlpha: number): void {
    if (!this.chipsLoaded || this.potRect.width <= 0 || this.scene.pot <= 0) return;

    const ante = Math.max(1, this.scene.ante || 5);
    const stacks = Math.max(1, Math.min(4, Math.ceil(this.scene.pot / (ante * 2))));
    const chipSize = Math.max(22, Math.min(34, this.potRect.height * 0.92));
    const cy = this.potRect.y + this.potRect.height * 0.52;

    // Left & right flanking poker chip stacks next to the POT pill
    const leftX = this.potRect.x - chipSize * 0.58;
    const rightX = this.potRect.x + this.potRect.width + chipSize * 0.58;

    if (leftX > chipSize * 0.45) {
      this.drawChipSprite(ctx, CHIPS_CARDS_SHEET_SPEC.cells.redChipStack, leftX, cy, chipSize);
      if (stacks >= 3 && leftX - chipSize * 0.55 > chipSize * 0.4) {
        this.drawChipSprite(
          ctx,
          CHIPS_CARDS_SHEET_SPEC.cells.greenChipStack,
          leftX - chipSize * 0.55,
          cy + 3,
          chipSize * 0.88
        );
      }
    }

    if (rightX < this.width - chipSize * 0.45) {
      if (stacks >= 2) {
        this.drawChipSprite(ctx, CHIPS_CARDS_SHEET_SPEC.cells.greenChipStack, rightX, cy, chipSize);
      }
      if (stacks >= 4 && rightX + chipSize * 0.55 < this.width - chipSize * 0.4) {
        this.drawChipSprite(
          ctx,
          CHIPS_CARDS_SHEET_SPEC.cells.redChipStack,
          rightX + chipSize * 0.55,
          cy + 3,
          chipSize * 0.88
        );
      }
    }

    // Gleaming golden wax-seal pot medallion when pot heats up
    if (sparkleAlpha > 0.14) {
      const medSize = Math.max(18, Math.min(26, chipSize * 0.82));
      const medX = this.potRect.x - chipSize * 0.12;
      const medY = this.potRect.y + 2;
      const bob = this.reducedMotion ? 0 : Math.sin(this.simTime * 3.0) * 1.8;
      this.drawChipSprite(
        ctx,
        CHIPS_CARDS_SHEET_SPEC.cells.potMedallion,
        medX,
        medY + bob,
        medSize,
        0,
        Math.min(0.95, 0.45 + sparkleAlpha * 0.55)
      );
    }
  }

  private drawSeatChipStack(
    ctx: CanvasRenderingContext2D,
    seatRect: Rect,
    chips: number,
    side: "left" | "right"
  ): void {
    if (!this.chipsLoaded || seatRect.width <= 0 || chips <= 0) return;

    const chipSize = Math.max(20, Math.min(30, seatRect.height * 0.34));
    const offsetX = side === "left" ? -chipSize * 0.48 : seatRect.width + chipSize * 0.48;
    const baseX = seatRect.x + offsetX;
    if (baseX < chipSize * 0.45 || baseX > this.width - chipSize * 0.45) return;

    const baseY = seatRect.y + seatRect.height - chipSize * 0.48;
    const highStack = chips >= Math.max(40, this.scene.startingChips * 0.6);

    this.drawChipSprite(ctx, CHIPS_CARDS_SHEET_SPEC.cells.redChipStack, baseX, baseY, chipSize);
    if (highStack) {
      this.drawChipSprite(
        ctx,
        CHIPS_CARDS_SHEET_SPEC.cells.greenChipStack,
        baseX + (side === "left" ? -chipSize * 0.42 : chipSize * 0.42),
        baseY + 2,
        chipSize * 0.88
      );
    }
  }

  private drawFlyingChips(ctx: CanvasRenderingContext2D): void {
    if (!this.chipsLoaded || this.flyingChips.length === 0) return;

    for (const chip of this.flyingChips) {
      const ev = evaluateFlyingChip(chip);
      if (!ev.visible || ev.alpha <= 0.01) continue;
      const cell =
        ev.variant === "green"
          ? CHIPS_CARDS_SHEET_SPEC.cells.greenChipStack
          : CHIPS_CARDS_SHEET_SPEC.cells.redChipStack;
      this.drawChipSprite(ctx, cell, ev.x, ev.y, 28 * ev.scale, ev.rotation, ev.alpha);
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.surface.removeEventListener("contentvisibilityautostatechange", this.onContentVisibilityChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.onWindowResize);
    }
    this.motionMediaQuery?.removeEventListener?.("change", this.onReducedMotionChange);
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.canvas.remove();
  }
}
