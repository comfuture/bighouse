import cardsArtSheetUrl from "./assets/images/cards_art_sheet.png?url";
import {
  createDirectionSwirlState,
  createImpactSparkles,
  createSuitWaveParticles,
  createWinConfetti,
  evaluateAttackAura,
  evaluateCardFlightPose,
  getSpriteCell,
  stepDirectionSwirl,
  stepFxParticles,
  type DirectionSwirlState,
  type FxParticle,
  type OneCardSpriteKey,
  type TurnDirection
} from "./animation";
import type { Suit } from "./rules";

export type FlightTrailTone = "play" | "draw" | "attack" | "turn";

export type OneCardFxState = {
  turnDirection: TurnDirection;
  activeAttackCount: number;
  chosenSuit?: Suit | undefined;
  hasWinner: boolean;
};

type ActiveFlightTrail = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  elapsedSec: number;
  durationSec: number;
  color: string;
  glow: string;
  landed: boolean;
  arcHeight?: number | undefined;
};

type Point = { x: number; y: number; radius: number };

const TRAIL_COLORS: Record<FlightTrailTone, { color: string; glow: string }> = {
  play: { color: "#fde68a", glow: "rgba(251, 191, 36, 0.55)" },
  draw: { color: "#93c5fd", glow: "rgba(96, 165, 250, 0.5)" },
  attack: { color: "#fca5a5", glow: "rgba(239, 68, 68, 0.65)" },
  turn: { color: "#6ee7b7", glow: "rgba(16, 185, 129, 0.55)" }
};

export class OneCardFxRenderer {
  private readonly hostEl: HTMLElement;
  private readonly centerStageEl: HTMLElement | null;
  private readonly discardEl: HTMLElement | null;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private spriteImg: HTMLImageElement | null = null;
  private spriteReady = false;

  private width = 0;
  private height = 0;
  private dpr = 1;
  private rafId: number | null = null;
  private lastTickMs = 0;
  private elapsedSec = 0;
  private emberAccumulator = 0;
  private destroyed = false;

  private isPageHidden = false;
  private isIntersecting = true;
  private isContentSkipped = false;
  private reducedMotion = false;

  private fxState: OneCardFxState = {
    turnDirection: "clockwise",
    activeAttackCount: 0,
    hasWinner: false
  };
  private swirlState: DirectionSwirlState = createDirectionSwirlState("clockwise");
  private particles: FxParticle[] = [];
  private trails: ActiveFlightTrail[] = [];

  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private motionMedia: MediaQueryList | null = null;

  private readonly onVisibilityChange: () => void;
  private readonly onContentVisibilityChange: (event: Event) => void;
  private readonly onWindowResize: () => void;
  private readonly onMotionPreferenceChange: () => void;

  constructor(hostEl: HTMLElement, centerStageEl: HTMLElement | null, discardEl: HTMLElement | null) {
    this.hostEl = hostEl;
    this.centerStageEl = centerStageEl;
    this.discardEl = discardEl;

    this.canvas = document.createElement("canvas");
    this.canvas.className = "onecard-fx-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    this.hostEl.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");

    if (typeof Image !== "undefined") {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        this.spriteReady = true;
      };
      img.src = cardsArtSheetUrl;
      this.spriteImg = img;
    }

    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      this.motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion = this.motionMedia.matches;
    }

    this.isPageHidden = typeof document !== "undefined" ? Boolean(document.hidden) : false;

    this.onVisibilityChange = () => {
      this.isPageHidden = typeof document !== "undefined" ? Boolean(document.hidden) : false;
      this.syncLoopState();
    };

    this.onContentVisibilityChange = (event: Event) => {
      const skipped = (event as Event & { skipped?: boolean }).skipped;
      this.isContentSkipped = Boolean(skipped);
      this.syncLoopState();
    };

    this.onWindowResize = () => {
      this.resizeCanvas();
    };

    this.onMotionPreferenceChange = () => {
      this.reducedMotion = Boolean(this.motionMedia?.matches);
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.hostEl.addEventListener("contentvisibilityautostatechange", this.onContentVisibilityChange);
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.onWindowResize);
    }
    if (this.motionMedia) {
      if (typeof this.motionMedia.addEventListener === "function") {
        this.motionMedia.addEventListener("change", this.onMotionPreferenceChange);
      }
    }
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
      this.resizeObserver.observe(this.hostEl);
    }
    if (typeof IntersectionObserver !== "undefined") {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry) {
            this.isIntersecting = entry.isIntersecting;
            this.syncLoopState();
          }
        },
        { threshold: 0.01 }
      );
      this.intersectionObserver.observe(this.hostEl);
    }

    this.resizeCanvas();
    this.syncLoopState();
  }

  public isReducedMotion(): boolean {
    return this.reducedMotion;
  }

  public setState(next: OneCardFxState): void {
    const prevDir = this.fxState.turnDirection;
    this.fxState = { ...next };
    if (prevDir !== next.turnDirection) {
      this.swirlState = stepDirectionSwirl(this.swirlState, next.turnDirection, 0.016, this.reducedMotion);
    }
  }

  public emitFlightTrail(params: {
    startClientX: number;
    startClientY: number;
    endClientX: number;
    endClientY: number;
    durationMs: number;
    tone: FlightTrailTone;
    arcHeight?: number | undefined;
  }): void {
    if (this.destroyed || this.width <= 0 || this.height <= 0) return;
    const hostRect = this.hostEl.getBoundingClientRect();
    const startX = params.startClientX - hostRect.left;
    const startY = params.startClientY - hostRect.top;
    const endX = params.endClientX - hostRect.left;
    const endY = params.endClientY - hostRect.top;
    const palette = TRAIL_COLORS[params.tone];

    this.trails.push({
      startX,
      startY,
      endX,
      endY,
      elapsedSec: 0,
      durationSec: Math.max(0.18, params.durationMs / 1000),
      color: palette.color,
      glow: palette.glow,
      landed: false,
      arcHeight: this.reducedMotion ? 10 : params.arcHeight
    });
    if (this.trails.length > 14) {
      this.trails.splice(0, this.trails.length - 14);
    }
  }

  public triggerSuitWave(suit: Suit): void {
    const anchor = this.getCenterAnchor();
    if (!anchor) return;
    const wave = createSuitWaveParticles(anchor.x, anchor.y, suit);
    this.pushParticles(this.reducedMotion ? wave.slice(0, 2) : wave);
  }

  public triggerReverseBurst(): void {
    const anchor = this.getCenterAnchor();
    if (!anchor) return;
    const items: FxParticle[] = [
      {
        kind: "ring",
        x: anchor.x,
        y: anchor.y,
        vx: 0,
        vy: 0,
        size: anchor.radius * 0.65,
        endSize: anchor.radius * 1.35,
        rotation: 0,
        vRot: 0,
        life: 0,
        maxLife: 0.65,
        color: "#fbbf24",
        secondaryColor: "rgba(251, 191, 36, 0.45)",
        gravity: 0,
        drag: 0
      },
      {
        kind: "medallion",
        x: anchor.x,
        y: anchor.y,
        vx: 0,
        vy: -14,
        size: 48,
        endSize: 66,
        rotation: 0,
        vRot: this.fxState.turnDirection === "clockwise" ? 2.4 : -2.4,
        life: 0,
        maxLife: 0.65,
        color: "#34d399",
        gravity: 0,
        drag: 1.5,
        spriteKey: "vfxReverse"
      }
    ];
    if (!this.reducedMotion) {
      items.push(...createImpactSparkles(anchor.x, anchor.y, "#fde68a", 12, true));
    }
    this.pushParticles(items);
  }

  public triggerJumpBurst(): void {
    const anchor = this.getDiscardAnchor() ?? this.getCenterAnchor();
    if (!anchor) return;
    const items: FxParticle[] = [
      {
        kind: "medallion",
        x: anchor.x,
        y: anchor.y - 12,
        vx: 0,
        vy: -42,
        size: 44,
        endSize: 60,
        rotation: -0.15,
        vRot: 0.8,
        life: 0,
        maxLife: 0.62,
        color: "#fbbf24",
        gravity: 40,
        drag: 1.6,
        spriteKey: "vfxJump"
      }
    ];
    if (!this.reducedMotion) {
      items.push(...createImpactSparkles(anchor.x, anchor.y, "#fbbf24", 10, true));
    }
    this.pushParticles(items);
  }

  public triggerAttackHit(): void {
    const anchor = this.getDiscardAnchor() ?? this.getCenterAnchor();
    if (!anchor) return;
    const items: FxParticle[] = [
      {
        kind: "ring",
        x: anchor.x,
        y: anchor.y,
        vx: 0,
        vy: 0,
        size: 32,
        endSize: 138,
        rotation: 0,
        vRot: 0,
        life: 0,
        maxLife: 0.48,
        color: "#f97316",
        secondaryColor: "rgba(239, 68, 68, 0.55)",
        gravity: 0,
        drag: 0
      },
      {
        kind: "medallion",
        x: anchor.x,
        y: anchor.y - 6,
        vx: 0,
        vy: -24,
        size: 46,
        endSize: 64,
        rotation: 0,
        vRot: 0.25,
        life: 0,
        maxLife: 0.56,
        color: "#ef4444",
        gravity: 0,
        drag: 1.4,
        spriteKey: "vfxAttack"
      }
    ];
    if (!this.reducedMotion) {
      items.push(...createImpactSparkles(anchor.x, anchor.y, "#fb923c", 14, true));
    }
    this.pushParticles(items);
  }

  public triggerJokerBurst(isColorJoker: boolean): void {
    const anchor = this.getDiscardAnchor() ?? this.getCenterAnchor();
    if (!anchor) return;
    const primary = isColorJoker ? "#f472b6" : "#e2e8f0";
    const items: FxParticle[] = [
      {
        kind: "ring",
        x: anchor.x,
        y: anchor.y,
        vx: 0,
        vy: 0,
        size: 28,
        endSize: 168,
        rotation: 0,
        vRot: 0,
        life: 0,
        maxLife: 0.62,
        color: primary,
        secondaryColor: isColorJoker ? "rgba(236, 72, 153, 0.5)" : "rgba(226, 232, 240, 0.42)",
        gravity: 0,
        drag: 0
      }
    ];
    if (!this.reducedMotion) {
      items.push(...createImpactSparkles(anchor.x, anchor.y, primary, 16, true));
      items.push(...createImpactSparkles(anchor.x, anchor.y, "#fbbf24", 8, true));
    }
    this.pushParticles(items);
  }

  public triggerOneCardAlert(): void {
    const anchor = this.getCenterAnchor();
    if (!anchor) return;
    this.pushParticles([
      {
        kind: "ring",
        x: anchor.x,
        y: anchor.y,
        vx: 0,
        vy: 0,
        size: 40,
        endSize: 175,
        rotation: 0,
        vRot: 0,
        life: 0,
        maxLife: 0.72,
        color: "#fbbf24",
        secondaryColor: "rgba(251, 191, 36, 0.48)",
        gravity: 0,
        drag: 0
      },
      ...(this.reducedMotion ? [] : createImpactSparkles(anchor.x, anchor.y, "#fde68a", 12, true))
    ]);
  }

  public triggerWinCelebration(): void {
    if (this.width <= 0 || this.height <= 0) return;
    const count = this.reducedMotion ? 14 : 46;
    this.pushParticles(createWinConfetti(this.width, this.height, count));
  }

  private pushParticles(items: FxParticle[]): void {
    this.particles.push(...items);
    if (this.particles.length > 180) {
      this.particles.splice(0, this.particles.length - 180);
    }
  }

  private resizeCanvas(): void {
    if (this.destroyed) return;
    const rect = this.hostEl.getBoundingClientRect();
    const w = Math.max(0, Math.round(rect.width));
    const h = Math.max(0, Math.round(rect.height));
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
  }

  private shouldRun(): boolean {
    return !this.destroyed && !this.isPageHidden && this.isIntersecting && !this.isContentSkipped;
  }

  private syncLoopState(): void {
    if (this.shouldRun()) {
      if (this.rafId === null && typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        this.lastTickMs = typeof performance !== "undefined" ? performance.now() : Date.now();
        this.rafId = window.requestAnimationFrame(this.tick);
      }
    } else if (this.rafId !== null) {
      if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
  }

  private readonly tick = (nowMs: number): void => {
    this.rafId = null;
    if (!this.shouldRun()) return;

    const dt = Math.min(0.05, Math.max(0, (nowMs - this.lastTickMs) / 1000));
    this.lastTickMs = nowMs;
    this.elapsedSec += dt;

    this.stepSimulation(dt);
    this.drawFrame();

    if (this.shouldRun()) {
      this.rafId = window.requestAnimationFrame(this.tick);
    }
  };

  private stepSimulation(dt: number): void {
    this.swirlState = stepDirectionSwirl(
      this.swirlState,
      this.fxState.turnDirection,
      dt,
      this.reducedMotion
    );

    // Step flight trails & emit landing sparkles
    const nextTrails: ActiveFlightTrail[] = [];
    for (const trail of this.trails) {
      trail.elapsedSec += dt;
      const progress = trail.elapsedSec / trail.durationSec;
      if (progress >= 1 && !trail.landed) {
        trail.landed = true;
        if (!this.reducedMotion) {
          this.pushParticles(createImpactSparkles(trail.endX, trail.endY, trail.color, 8, true));
        }
      }
      if (trail.elapsedSec < trail.durationSec + 0.24) {
        nextTrails.push(trail);
      }
    }
    this.trails = nextTrails;

    // Spawn rising embers around discard pile while an attack stack is active
    const aura = evaluateAttackAura(this.fxState.activeAttackCount, this.elapsedSec, this.reducedMotion);
    if (aura.active) {
      this.emberAccumulator += aura.emberRate * dt;
      const discardAnchor = this.getDiscardAnchor();
      while (this.emberAccumulator >= 1 && discardAnchor) {
        this.emberAccumulator -= 1;
        const angle = (this.elapsedSec * 5.7 + this.particles.length * 1.618) % (Math.PI * 2);
        const r = discardAnchor.radius * (0.78 + (this.particles.length % 3) * 0.14);
        this.pushParticles([
          {
            kind: "ember",
            x: discardAnchor.x + Math.cos(angle) * r,
            y: discardAnchor.y + Math.sin(angle) * r,
            vx: Math.cos(angle) * 16,
            vy: -36 - aura.intensity * 36,
            size: 3.5 + aura.intensity * 3,
            rotation: angle,
            vRot: 2.2,
            life: 0,
            maxLife: 0.55 + aura.intensity * 0.25,
            color: this.particles.length % 2 === 0 ? "#fb923c" : "#fef08a",
            gravity: -18,
            drag: 1.2
          }
        ]);
      }
    } else {
      this.emberAccumulator = 0;
    }

    this.particles = stepFxParticles(this.particles, dt);
  }

  private getCenterAnchor(): Point | null {
    if (!this.centerStageEl || this.width <= 0 || this.height <= 0) return null;
    const hostRect = this.hostEl.getBoundingClientRect();
    const rect = this.centerStageEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left - hostRect.left + rect.width * 0.5,
      y: rect.top - hostRect.top + rect.height * 0.5,
      radius: Math.max(66, Math.min(138, Math.max(rect.width, rect.height) * 0.62))
    };
  }

  private getDiscardAnchor(): Point | null {
    if (!this.discardEl || this.width <= 0 || this.height <= 0) return null;
    const hostRect = this.hostEl.getBoundingClientRect();
    const rect = this.discardEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: rect.left - hostRect.left + rect.width * 0.5,
      y: rect.top - hostRect.top + rect.height * 0.5,
      radius: Math.max(40, Math.hypot(rect.width, rect.height) * 0.52)
    };
  }

  private drawFrame(): void {
    const ctx = this.ctx;
    if (!ctx || this.width <= 0 || this.height <= 0) return;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawDirectionSwirl(ctx);
    this.drawAttackAura(ctx);
    this.drawFlightTrails(ctx);
    this.drawParticles(ctx);

    ctx.restore();
  }

  private drawDirectionSwirl(ctx: CanvasRenderingContext2D): void {
    const anchor = this.getCenterAnchor();
    if (!anchor) return;

    const isCw = this.swirlState.directionSign > 0;
    const flash = this.swirlState.flashIntensity;
    const baseHue = isCw ? "52, 211, 153" : "96, 165, 250";
    const accentHue = flash > 0.08 ? "251, 191, 36" : baseHue;
    const r = anchor.radius;

    ctx.save();
    ctx.translate(anchor.x, anchor.y);

    // Soft ambient halo ring
    const ringAlpha = 0.14 + flash * 0.32;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${accentHue}, ${ringAlpha.toFixed(3)})`;
    ctx.lineWidth = 1.5 + flash * 2.5;
    ctx.stroke();

    // 3 orbiting glowing directional arcs with chevron tips
    const arcCount = 3;
    const arcSpan = Math.PI * 0.36;
    for (let i = 0; i < arcCount; i += 1) {
      const headAngle = this.swirlState.angleRad + (i * Math.PI * 2) / arcCount;
      const tailAngle = headAngle - this.swirlState.directionSign * arcSpan;

      const grad = ctx.createLinearGradient(
        Math.cos(tailAngle) * r,
        Math.sin(tailAngle) * r,
        Math.cos(headAngle) * r,
        Math.sin(headAngle) * r
      );
      grad.addColorStop(0, `rgba(${baseHue}, 0)`);
      grad.addColorStop(0.65, `rgba(${baseHue}, ${(0.28 + flash * 0.35).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${accentHue}, ${(0.72 + flash * 0.25).toFixed(3)})`);

      ctx.beginPath();
      ctx.arc(0, 0, r, tailAngle, headAngle, !isCw);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.6 + flash * 2;
      ctx.lineCap = "round";
      ctx.stroke();

      // Directional chevron arrowhead at arc tip
      const hx = Math.cos(headAngle) * r;
      const hy = Math.sin(headAngle) * r;
      const tangent = headAngle + (isCw ? Math.PI * 0.5 : -Math.PI * 0.5);
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(tangent);
      ctx.beginPath();
      ctx.moveTo(5.5, 0);
      ctx.lineTo(-4.5, -4.2);
      ctx.lineTo(-2.2, 0);
      ctx.lineTo(-4.5, 4.2);
      ctx.closePath();
      ctx.fillStyle = `rgba(${accentHue}, ${(0.78 + flash * 0.2).toFixed(3)})`;
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawAttackAura(ctx: CanvasRenderingContext2D): void {
    const aura = evaluateAttackAura(this.fxState.activeAttackCount, this.elapsedSec, this.reducedMotion);
    if (!aura.active) return;
    const anchor = this.getDiscardAnchor();
    if (!anchor) return;

    const r = anchor.radius * aura.ringRadiusScale;
    ctx.save();
    ctx.translate(anchor.x, anchor.y);

    // Radial ember glow around discard pile
    const glowGrad = ctx.createRadialGradient(0, 0, r * 0.55, 0, 0, r * 1.38);
    glowGrad.addColorStop(0, "rgba(239, 68, 68, 0)");
    glowGrad.addColorStop(0.6, `rgba(239, 68, 68, ${(0.18 + aura.intensity * 0.22 + aura.pulse * 0.1).toFixed(3)})`);
    glowGrad.addColorStop(0.82, `rgba(251, 146, 60, ${(0.24 + aura.intensity * 0.26).toFixed(3)})`);
    glowGrad.addColorStop(1, "rgba(251, 191, 36, 0)");
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.38, 0, Math.PI * 2);
    ctx.fill();

    // Inner crackling plasma ring
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(251, 146, 60, ${(0.45 + aura.intensity * 0.4).toFixed(3)})`;
    ctx.lineWidth = 2 + aura.intensity * 2.4;
    ctx.stroke();

    // Smoothly undulating electric lightning arcs (capped <= 2Hz, no harsh strobe)
    const phaseStep = (Math.PI * 2) / aura.arcCount;
    for (let i = 0; i < aura.arcCount; i += 1) {
      const baseAngle = this.elapsedSec * (this.reducedMotion ? 0.4 : 1.45) + i * phaseStep;
      const arcSpan = 0.42 + aura.intensity * 0.22;
      ctx.beginPath();
      const segs = 6;
      for (let s = 0; s <= segs; s += 1) {
        const frac = s / segs;
        const ang = baseAngle + frac * arcSpan;
        const wobble =
          s === 0 || s === segs
            ? 0
            : Math.sin(this.elapsedSec * 7.5 + i * 3.1 + s * 2.4) * (3 + aura.intensity * 5.5);
        const rr = r + wobble;
        const px = Math.cos(ang) * rr;
        const py = Math.sin(ang) * rr;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = i % 2 === 0 ? "rgba(254, 240, 138, 0.85)" : "rgba(251, 146, 60, 0.78)";
      ctx.lineWidth = 1.6 + aura.intensity * 1.2;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawFlightTrails(ctx: CanvasRenderingContext2D): void {
    if (this.trails.length === 0) return;

    for (const trail of this.trails) {
      const headT = Math.min(1, trail.elapsedSec / trail.durationSec);
      const fadeOut =
        trail.elapsedSec > trail.durationSec
          ? Math.max(0, 1 - (trail.elapsedSec - trail.durationSec) / 0.24)
          : 1;
      const tailT = Math.max(0, headT - 0.38);
      if (headT <= tailT || fadeOut <= 0.01) continue;

      const steps = 10;
      ctx.save();
      ctx.lineCap = "round";
      for (let s = 1; s <= steps; s += 1) {
        const t0 = tailT + ((s - 1) / steps) * (headT - tailT);
        const t1 = tailT + (s / steps) * (headT - tailT);
        const p0 = evaluateCardFlightPose({
          startX: trail.startX,
          startY: trail.startY,
          endX: trail.endX,
          endY: trail.endY,
          progress: t0,
          arcHeight: trail.arcHeight
        });
        const p1 = evaluateCardFlightPose({
          startX: trail.startX,
          startY: trail.startY,
          endX: trail.endX,
          endY: trail.endY,
          progress: t1,
          arcHeight: trail.arcHeight
        });
        const frac = s / steps;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = trail.glow;
        ctx.globalAlpha = frac * 0.55 * fadeOut;
        ctx.lineWidth = 3 + frac * 11;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = trail.color;
        ctx.globalAlpha = frac * 0.82 * fadeOut;
        ctx.lineWidth = 1.5 + frac * 3.5;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawSprite(
    ctx: CanvasRenderingContext2D,
    key: OneCardSpriteKey,
    x: number,
    y: number,
    size: number,
    rotation: number,
    alpha: number
  ): void {
    if (!this.spriteReady || !this.spriteImg) return;
    const cell = getSpriteCell(key);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.drawImage(
      this.spriteImg,
      cell.x,
      cell.y,
      cell.width,
      cell.height,
      -size * 0.5,
      -size * 0.5,
      size,
      size
    );
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const progress = p.life / p.maxLife;
      const alpha = progress < 0.15 ? progress / 0.15 : Math.max(0, 1 - (progress - 0.15) / 0.85);
      if (alpha <= 0.01) continue;

      if (p.kind === "ring") {
        const radius = p.size + ((p.endSize ?? p.size * 3) - p.size) * (1 - Math.pow(1 - progress, 3));
        ctx.save();
        ctx.globalAlpha = alpha * 0.78;
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1.2, 4.5 * (1 - progress));
        ctx.stroke();
        ctx.restore();
        continue;
      }

      if (p.kind === "medallion" && p.spriteKey && this.spriteReady) {
        const size = p.size + ((p.endSize ?? p.size) - p.size) * progress;
        this.drawSprite(ctx, p.spriteKey, p.x, p.y, size, p.rotation, alpha * 0.92);
        continue;
      }

      if (p.kind === "sparkle") {
        if (p.spriteKey && this.spriteReady) {
          const s = p.size * (0.7 + 0.45 * Math.sin(progress * Math.PI));
          this.drawSprite(ctx, p.spriteKey, p.x, p.y, s, p.rotation, alpha);
        } else {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          const r = p.size * 0.42;
          ctx.beginPath();
          ctx.moveTo(0, -r);
          ctx.lineTo(r * 0.3, -r * 0.3);
          ctx.lineTo(r, 0);
          ctx.lineTo(r * 0.3, r * 0.3);
          ctx.lineTo(0, r);
          ctx.lineTo(-r * 0.3, r * 0.3);
          ctx.lineTo(-r, 0);
          ctx.lineTo(-r * 0.3, -r * 0.3);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        continue;
      }

      if (p.kind === "ember") {
        ctx.save();
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, p.size * (1 - progress * 0.5)), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      // Confetti ribbon
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.scale(Math.cos(progress * 9 + p.rotation), 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size * 0.5, -p.size * 0.28, p.size, p.size * 0.56);
      ctx.restore();
    }
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.rafId !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    this.hostEl.removeEventListener("contentvisibilityautostatechange", this.onContentVisibilityChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.onWindowResize);
    }
    if (this.motionMedia && typeof this.motionMedia.removeEventListener === "function") {
      this.motionMedia.removeEventListener("change", this.onMotionPreferenceChange);
    }
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.canvas.remove();
  }
}
